import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart' as crypto;
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/update_progress.dart';
import 'device_intent_service.dart';
import 'update_messages.dart';
import 'update_version.dart';

/// What is known about a newer build, whichever channel owns this install.
///
/// Two channels exist and they must never be mixed: a Play-installed app is
/// updated by Play (policy forbids anything else, and the signing keys differ),
/// while a sideloaded build is updated over the hub. [playManaged] says which
/// one applies, and the UI routes on it.
class AppUpdateInfo {
  final String versionName;
  final int versionCode;
  final String sha256;
  final int sizeBytes;

  /// Where the APK is fetched from. For a hub that publishes `apkPath` this is
  /// `<configured hub base URL>/apk` and never carries the pairing token; only
  /// an older hub hands out a URL with the token in its query string.
  final String url;
  final bool updateAvailable;

  /// True when Google Play owns this install, so Play performs the update.
  final bool playManaged;

  /// True when [url] must be fetched with `Authorization: Bearer <token>`
  /// (the hub advertised `apkPath`) instead of a token embedded in the URL.
  final bool bearerAuth;

  /// `"apk-metadata"` or `"pubspec"` on a hub that reports where the version
  /// came from, empty otherwise. `"pubspec"` means the hub guessed the version
  /// from pubspec.yaml rather than reading it out of the built APK.
  final String versionSource;

  /// "2.5.5 (33)": the build that is installed now, for the update dialog's
  /// "this build -> new build" row. Empty when it is not known (Play reports
  /// only a versionCode, and tests build infos without it).
  final String installedLabel;

  const AppUpdateInfo({
    required this.versionName,
    required this.versionCode,
    required this.sha256,
    required this.sizeBytes,
    required this.url,
    required this.updateAvailable,
    this.playManaged = false,
    this.bearerAuth = false,
    this.versionSource = '',
    this.installedLabel = '',
  });

  /// First 16 hex digits of [sha256] for display; safe for an empty hash (a
  /// Play-managed update has none).
  String get shortSha =>
      sha256.length > 16 ? '${sha256.substring(0, 16)}...' : sha256;
}

/// In-app update channel (OTA).
///
/// Sideloaded installs: the hub publishes the APK it just built, plus its
/// SHA-256, on `GET /api/app/latest`; this service asks whether that build is
/// newer than the one installed, downloads it into the app cache, checks the
/// byte count and the SHA-256 and hands the file to the system package
/// installer.
///
/// Play installs: none of the above is legal or possible, so the question is
/// put to Play instead (`playUpdateInfo`) and the update itself is run by Play's
/// own full-screen flow (`startPlayUpdate`).
///
/// Either way the final confirmation belongs to the device owner: an app cannot
/// replace itself silently unless it is the device owner.
class AppUpdateService {
  AppUpdateService._();

  /// Subclass hook for tests (a fake service); production uses [instance].
  @visibleForTesting
  AppUpdateService.forTesting();

  static final AppUpdateService instance = AppUpdateService._();

  /// SharedPreferences key of the "check for updates automatically" switch.
  /// The plugin stores it as `flutter.autoUpdateCheck` in the
  /// `FlutterSharedPreferences` file, which is where the native
  /// UpdateCheckWorker reads it.
  static const autoCheckKey = 'autoUpdateCheck';
  static const _dismissedCodeKey = 'updateDismissedCode';
  static const _dismissedAtKey = 'updateDismissedAtMs';

  /// How long "Later" silences the prompt for one published versionCode.
  static const laterDuration = Duration(hours: 24);

  /// Why the last [check] found nothing, in words for the user (offline,
  /// unauthorized, no update channel on the hub, ...). Null after a successful
  /// check, including one that simply found no newer build.
  String? lastCheckError;

  bool? _playOwned;
  String _lastToken = '';

  // Network seams. Production defaults; tests swap them out.
  @visibleForTesting
  http.Client Function() clientFactory = http.Client.new;
  @visibleForTesting
  Future<Directory> Function() cacheDirProvider = getTemporaryDirectory;
  @visibleForTesting
  Duration checkTimeout = const Duration(seconds: 8);
  @visibleForTesting
  Duration connectTimeout = const Duration(seconds: 20);
  @visibleForTesting
  Duration stallTimeout = const Duration(seconds: 30);

  /// Bytes written between flushes of the download sink (see the loop below).
  static const _flushEvery = 4 << 20;

  /// The install source cannot change while the app is running, so the answer is
  /// cached. Test seam, because the cache would otherwise leak between tests.
  @visibleForTesting
  void debugResetPlayOwned() => _playOwned = null;

  /// True when Google Play installed this build, so Play owns its updates.
  Future<bool> isPlayOwned() async {
    _playOwned ??= (await DeviceIntentService.installerPackage()) ==
        'com.android.vending';
    return _playOwned!;
  }

  // ---- Opt-out and "Later" ----

  /// Whether the user allows automatic update checks (default true).
  Future<bool> autoCheckEnabled() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getBool(autoCheckKey) ?? true;
    } catch (_) {
      return true;
    }
  }

  Future<void> setAutoCheckEnabled(bool enabled) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(autoCheckKey, enabled);
    } catch (_) {/* preferences unavailable: the switch just will not stick */}
  }

  /// Remembers that the user tapped "Later" for [versionCode].
  Future<void> dismiss(int versionCode, {DateTime? now}) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setInt(_dismissedCodeKey, versionCode);
      await prefs.setInt(
          _dismissedAtKey, (now ?? DateTime.now()).millisecondsSinceEpoch);
    } catch (_) {/* best effort */}
  }

  /// True while a "Later" for exactly this [versionCode] is under
  /// [laterDuration] old. A newer build is never covered by an older "Later".
  Future<bool> isDismissed(int versionCode, {DateTime? now}) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (prefs.getInt(_dismissedCodeKey) != versionCode) return false;
      final at = prefs.getInt(_dismissedAtKey);
      if (at == null) return false;
      final age = (now ?? DateTime.now()).millisecondsSinceEpoch - at;
      return age >= 0 && age < laterDuration.inMilliseconds;
    } catch (_) {
      return false;
    }
  }

  // ---- Version comparison ----

  /// See [compareUpdateVersions] (kept here so callers and tests keep one name).
  static int compareVersions(String a, String b) => compareUpdateVersions(a, b);

  /// See [isNewerUpdateBuild].
  static bool isNewerBuild({
    required String installedName,
    required int installedCode,
    required String remoteName,
    required int remoteCode,
  }) =>
      isNewerUpdateBuild(
        installedName: installedName,
        installedCode: installedCode,
        remoteName: remoteName,
        remoteCode: remoteCode,
      );

  // ---- Checking ----

  /// Asks the owning channel what the latest build is, comparing against the
  /// installed versionCode. Returns null when nothing newer is known, or when
  /// the relevant service cannot be reached; in the latter case
  /// [lastCheckError] says why. Never throws.
  ///
  /// An automatic check (the default) does nothing at all while the user has
  /// switched automatic checks off; a [manual] one - a "Check now" tap - always
  /// runs.
  Future<AppUpdateInfo?> check({
    required String hubUrl,
    required String token,
    bool manual = false,
  }) async {
    lastCheckError = null;
    if (!manual && !await autoCheckEnabled()) return null;
    _lastToken = token;
    if (await isPlayOwned()) return _checkPlay();
    final base = hubUrl.trim().replaceAll(RegExp(r'/+$'), '');
    if (base.isEmpty) {
      lastCheckError =
          'No hub address is set. Pair this phone with your desktop first.';
      return null;
    }
    final version = await DeviceIntentService.appVersion();
    final client = clientFactory();
    try {
      final res = await client.get(
        Uri.parse('$base/api/app/latest?versionCode=${version.code}'),
        headers: <String, String>{'Authorization': 'Bearer $token'},
      ).timeout(checkTimeout);
      if (res.statusCode == 401 || res.statusCode == 403) {
        lastCheckError =
            'The hub rejected the pairing token. Pair this phone again.';
        return null;
      }
      if (res.statusCode == 404) {
        lastCheckError = 'This hub has no update channel: no release build '
            'is published, or the hub is too old.';
        return null;
      }
      if (res.statusCode != 200) {
        lastCheckError = 'Update check failed (HTTP ${res.statusCode}).';
        return null;
      }
      final decoded = jsonDecode(res.body);
      if (decoded is! Map<String, dynamic>) {
        lastCheckError = 'The hub sent an update manifest this app cannot read.';
        return null;
      }
      return _parseHubManifest(decoded, base, version);
    } on TimeoutException {
      lastCheckError = _offlineMessage;
      return null;
    } on SocketException {
      lastCheckError = _offlineMessage;
      return null;
    } on http.ClientException {
      lastCheckError = _offlineMessage;
      return null;
    } on FormatException {
      lastCheckError = 'The hub sent an update manifest this app cannot read.';
      return null;
    } catch (e) {
      lastCheckError = 'Update check failed (${e.runtimeType}).';
      return null;
    } finally {
      client.close();
    }
  }

  static const _offlineMessage =
      'Could not reach the hub. Check the connection and the hub address.';

  AppUpdateInfo _parseHubManifest(
    Map<String, dynamic> body,
    String base,
    ({String name, int code}) installed,
  ) {
    final versionName = body['versionName']?.toString() ?? '';
    final versionCode = (body['versionCode'] as num?)?.toInt() ?? 0;
    // Trust the hub's flag only if the numbers agree. A hub that guessed its
    // version from pubspec.yaml can claim "newer" for a build that is not, and
    // installing it would loop forever on "update required".
    final newer = installed.code > 0
        ? isNewerBuild(
            installedName: installed.name,
            installedCode: installed.code,
            remoteName: versionName,
            remoteCode: versionCode,
          )
        : true;
    final apkPath = body['apkPath']?.toString() ?? '';
    final bearer = apkPath.startsWith('/');
    final legacyUrl =
        (body['downloadUrl'] ?? body['url'])?.toString() ?? '';
    return AppUpdateInfo(
      versionName: versionName,
      versionCode: versionCode,
      sha256: body['sha256']?.toString() ?? '',
      sizeBytes: (body['sizeBytes'] as num?)?.toInt() ?? 0,
      url: bearer ? '$base$apkPath' : legacyUrl,
      updateAvailable: body['updateAvailable'] == true && newer,
      bearerAuth: bearer,
      versionSource: body['versionSource']?.toString() ?? '',
      installedLabel:
          installed.code > 0 ? '${installed.name} (${installed.code})' : '',
    );
  }

  /// The Play half: Play reports only a versionCode, and answers from the store
  /// even when the desktop hub is unreachable.
  Future<AppUpdateInfo?> _checkPlay() async {
    final raw = await DeviceIntentService.playUpdateInfo();
    if (raw == null) {
      lastCheckError = 'Google Play could not be asked about updates.';
      return null;
    }
    // 2 == UPDATE_AVAILABLE. 3 == DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS: an
    // immediate update was started and never finished, and Play expects the app
    // to resume it, so it is offered again exactly like a fresh one.
    final availability = (raw['updateAvailability'] as num?)?.toInt();
    if (availability != 2 && availability != 3) return null;
    final code = (raw['availableVersionCode'] as num?)?.toInt() ?? 0;
    return AppUpdateInfo(
      versionName: '$code',
      versionCode: code,
      sha256: '',
      sizeBytes: 0,
      url: '',
      updateAvailable: true,
      playManaged: true,
    );
  }

  // ---- Installing ----

  /// Starts Play's own update flow. Immediate is the full-screen one the owner
  /// cannot dismiss and which only ends by installing; Play runs the download,
  /// the signature check and the install, so nothing here touches the APK.
  ///
  /// Returns "installed", "canceled", "failed" or "unavailable".
  Future<String> startPlayUpdate() => DeviceIntentService.startPlayUpdate();

  /// Runs the update through whichever channel owns [info] and returns a short
  /// human-readable line for the UI. The single place that routes Play versus
  /// hub, so no screen can send a Play-managed update down the APK path.
  Future<String> install(
    AppUpdateInfo info, {
    String? token,
    void Function(UpdateProgress progress)? onProgress,
  }) async {
    if (!info.playManaged) {
      return downloadAndInstall(info, token: token, onProgress: onProgress);
    }
    return switch (await startPlayUpdate()) {
      'installed' => 'Installed - Google Play restarted the app.',
      'canceled' => 'Update cancelled. It is still required.',
      'unavailable' => 'Google Play has no update to install right now.',
      _ => 'Google Play could not start the update. Try again.',
    };
  }

  /// What to tell the user for a native `installApk` status string
  /// (see [updateInstallResultMessage]).
  static String installResultMessage(String status) =>
      updateInstallResultMessage(status);

  /// Downloads the published APK, verifies it and opens the installer. Returns
  /// a short human-readable line for the UI / activity feed either way.
  ///
  /// The transfer has a connect timeout and a stall timeout, a partial or
  /// rejected file is always deleted, and older `screensync-*.apk` files are
  /// purged first so the cache cannot pile up. Error lines never echo the URL:
  /// a legacy hub puts the pairing token in it.
  Future<String> downloadAndInstall(
    AppUpdateInfo info, {
    String? token,
    void Function(UpdateProgress progress)? onProgress,
  }) async {
    if (info.url.isEmpty) return 'The hub did not publish a download URL.';
    final File target;
    try {
      final dir = await cacheDirProvider();
      await _purgeOldApks(dir);
      target = File('${dir.path}/screensync-${info.versionCode}.apk');
    } catch (_) {
      return 'Update download failed: no space to store the file.';
    }

    var keep = false;
    IOSink? sink;
    final client = clientFactory();
    try {
      final request = http.Request('GET', Uri.parse(info.url));
      if (info.bearerAuth) {
        request.headers['Authorization'] = 'Bearer ${token ?? _lastToken}';
      }
      final res = await client.send(request).timeout(connectTimeout);
      if (res.statusCode != 200) {
        return 'Download failed (HTTP ${res.statusCode}).';
      }
      sink = target.openWrite();
      var written = 0;
      var flushedAt = 0;
      onProgress?.call(UpdateProgress.downloading(0, info.sizeBytes));
      await for (final chunk in res.stream.timeout(stallTimeout)) {
        written += chunk.length;
        sink.add(chunk);
        // Backpressure: an IOSink buffers without limit, so on a slow disk the
        // "download" would reach 100% in memory (the whole APK in RAM) while
        // the file is still being written. Flushing every 4 MiB keeps memory
        // bounded (and lets the network and the disk overlap) while progress
        // still means "on disk" to within a few percent.
        if (written - flushedAt >= _flushEvery) {
          await sink.flush();
          flushedAt = written;
        }
        onProgress?.call(UpdateProgress.downloading(written, info.sizeBytes));
      }
      await sink.flush();
      await sink.close();
      sink = null;

      // The package installer checks the signing certificate, which is the real
      // security boundary. These two only catch a truncated or corrupted
      // transfer, because a half-downloaded APK fails to install with a
      // confusing parse error.
      if (info.sizeBytes > 0 && written != info.sizeBytes) {
        return 'Download incomplete: $written of ${info.sizeBytes} bytes.';
      }
      final expected = info.sha256.trim().toLowerCase();
      onProgress?.call(const UpdateProgress.verifying());
      if (expected.isNotEmpty) {
        final actual =
            (await crypto.sha256.bind(target.openRead()).first).toString();
        if (actual != expected) {
          return 'The downloaded update failed its SHA-256 check and was '
              'discarded. Try again.';
        }
      }
      keep = true;
    } on TimeoutException {
      return 'Download timed out: the hub stopped responding.';
    } on SocketException {
      return 'Download failed: could not reach the hub.';
    } on http.ClientException {
      return 'Download failed: could not reach the hub.';
    } catch (e) {
      return 'Update download failed (${e.runtimeType}).';
    } finally {
      client.close();
      try {
        await sink?.close();
      } catch (_) {/* the file is deleted below anyway */}
      if (!keep) {
        try {
          if (target.existsSync()) target.deleteSync();
        } catch (_) {/* best effort */}
      }
    }

    onProgress?.call(const UpdateProgress.opening());
    return installResultMessage(await DeviceIntentService.installApk(target.path));
  }

  /// Deletes every earlier `screensync-*.apk` in [dir].
  Future<void> _purgeOldApks(Directory dir) async {
    try {
      await for (final entry in dir.list(followLinks: false)) {
        if (entry is! File) continue;
        final name = entry.uri.pathSegments.last;
        if (!name.startsWith('screensync-') || !name.endsWith('.apk')) continue;
        try {
          await entry.delete();
        } catch (_) {/* in use or already gone */}
      }
    } catch (_) {/* nothing to purge */}
  }
}
