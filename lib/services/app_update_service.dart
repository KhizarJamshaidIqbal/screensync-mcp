import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import 'device_intent_service.dart';

/// What the hub reports about the newest published Android build.
class AppUpdateInfo {
  final String versionName;
  final int versionCode;
  final String sha256;
  final int sizeBytes;
  final String url;
  final bool updateAvailable;

  const AppUpdateInfo({
    required this.versionName,
    required this.versionCode,
    required this.sha256,
    required this.sizeBytes,
    required this.url,
    required this.updateAvailable,
  });
}

/// In-app update channel (OTA).
///
/// The hub publishes the APK it just built, plus its SHA-256, on
/// `GET /api/app/latest`; this service asks whether that build is newer than the
/// one installed, downloads it into the app cache, sanity-checks the byte count
/// and hands the file to the system package installer.
///
/// Android will always show its own confirmation sheet: a sideloaded app cannot
/// replace itself silently unless it is the device owner. So "automatic update"
/// here means the phone learns about the release, fetches it and pre-verifies it
/// - the final tap belongs to the device owner.
class AppUpdateService {
  AppUpdateService._();
  static final AppUpdateService instance = AppUpdateService._();

  AppUpdateInfo? lastSeen;

  /// Asks the hub what the latest build is, comparing against the installed
  /// versionCode read from the package manager. Returns null when the hub is
  /// unreachable, unpaired, or has no APK built yet.
  Future<AppUpdateInfo?> check({
    required String hubUrl,
    required String token,
  }) async {
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
