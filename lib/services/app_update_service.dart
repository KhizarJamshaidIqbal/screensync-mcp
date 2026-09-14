import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import 'device_intent_service.dart';

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
  final String url;
  final bool updateAvailable;

  /// True when Google Play owns this install, so Play performs the update.
  final bool playManaged;

  const AppUpdateInfo({
    required this.versionName,
    required this.versionCode,
    required this.sha256,
    required this.sizeBytes,
    required this.url,
    required this.updateAvailable,
    this.playManaged = false,
  });
}

/// In-app update channel (OTA).
///
/// Sideloaded installs: the hub publishes the APK it just built, plus its
/// SHA-256, on `GET /api/app/latest`; this service asks whether that build is
/// newer than the one installed, downloads it into the app cache, checks the
/// byte count and hands the file to the system package installer.
///
/// Play installs: none of the above is legal or possible, so the question is
/// put to Play instead (`playUpdateInfo`) and the update itself is run by Play's
/// own full-screen flow (`startPlayUpdate`).
///
/// Either way the final confirmation belongs to the device owner: an app cannot
/// replace itself silently unless it is the device owner.
class AppUpdateService {
  AppUpdateService._();
  static final AppUpdateService instance = AppUpdateService._();

  AppUpdateInfo? lastSeen;

  bool? _playOwned;

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

  /// Asks the owning channel what the latest build is, comparing against the
  /// installed versionCode. Returns null when nothing newer is known, or when
  /// the relevant service cannot be reached.
  Future<AppUpdateInfo?> check({
    required String hubUrl,
    required String token,
  }) async {
    if (await isPlayOwned()) return _checkPlay();
    final base = hubUrl.trim().replaceAll(RegExp(r'/+$'), '');
    if (base.isEmpty) return null;
    final version = await DeviceIntentService.appVersion();
    try {
      final res = await http.get(
        Uri.parse('$base/api/app/latest?versionCode=${version.code}'),
        headers: <String, String>{'Authorization': 'Bearer $token'},
      ).timeout(const Duration(seconds: 8));
      if (res.statusCode != 200) return null;
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      final info = AppUpdateInfo(
        versionName: body['versionName']?.toString() ?? '',
        versionCode: (body['versionCode'] as num?)?.toInt() ?? 0,
        sha256: body['sha256']?.toString() ?? '',
        sizeBytes: (body['sizeBytes'] as num?)?.toInt() ?? 0,
        url: body['url']?.toString() ?? '',
        updateAvailable: body['updateAvailable'] == true,
      );
      lastSeen = info;
      return info;
    } catch (_) {
      return null;
    }
  }

  /// The Play half: Play reports only a versionCode, and answers from the store
  /// even when the desktop hub is unreachable.
  Future<AppUpdateInfo?> _checkPlay() async {
    final raw = await DeviceIntentService.playUpdateInfo();
    if (raw == null) return null;
    // 2 == UpdateAvailability.UPDATE_AVAILABLE
    if (raw['updateAvailability'] != 2) return null;
    final code = (raw['availableVersionCode'] as num?)?.toInt() ?? 0;
    final info = AppUpdateInfo(
      versionName: '$code',
      versionCode: code,
      sha256: '',
      sizeBytes: 0,
      url: '',
      updateAvailable: true,
      playManaged: true,
    );
    lastSeen = info;
    return info;
  }

  /// Starts Play's own update flow. Immediate is the full-screen one the owner
  /// cannot dismiss and which only ends by installing; Play runs the download,
  /// the signature check and the install, so nothing here touches the APK.
  ///
  /// Returns "installed", "canceled", "failed" or "unavailable".
  Future<String> startPlayUpdate() => DeviceIntentService.startPlayUpdate();

  /// Downloads the published APK and opens the installer. Returns a short
  /// human-readable line for the UI / activity feed either way.
  Future<String> downloadAndInstall(AppUpdateInfo info) async {
    if (info.url.isEmpty) return 'The hub did not publish a download URL.';
    File? target;
    try {
      final dir = await getTemporaryDirectory();
      target = File('${dir.path}/screensync-${info.versionCode}.apk');
      if (target.existsSync()) target.deleteSync();

      final client = http.Client();
      var written = 0;
      try {
        final res = await client.send(http.Request('GET', Uri.parse(info.url)));
        if (res.statusCode != 200) {
          return 'Download failed (HTTP ${res.statusCode}).';
        }
        final sink = target.openWrite();
        await for (final chunk in res.stream) {
          written += chunk.length;
          sink.add(chunk);
        }
        await sink.flush();
        await sink.close();
      } finally {
        client.close();
      }

      // The package installer checks the signing certificate, which is the real
      // security boundary. This only catches a truncated transfer, because a
      // half-downloaded APK fails to install with a confusing parse error.
      if (info.sizeBytes > 0 && written != info.sizeBytes) {
        return 'Download incomplete: $written of ${info.sizeBytes} bytes.';
      }
    } catch (e) {
      return 'Update download failed: $e';
    }

    final opened = await DeviceIntentService.installApk(target.path);
    return opened
        ? 'Installer opened - confirm the update on your phone.'
        : 'Could not open the installer for $target.';
  }
}
