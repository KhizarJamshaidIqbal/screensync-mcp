import 'package:flutter/services.dart';
import 'dart:async';

/// Native helpers for the Permission Doctor and keep-alive notification snaps.
class DeviceIntentService {
  DeviceIntentService._();
  static const _channel = MethodChannel('com.screensync.mcp/device');

  static Future<String> deviceBrand() async {
    try {
      return await _channel.invokeMethod<String>('deviceBrand') ?? 'stock';
    } on PlatformException {
      return 'stock';
    }
  }

  static Future<bool> batteryWhitelisted() async {
    try {
      return await _channel.invokeMethod<bool>('batteryWhitelisted') ?? false;
    } on PlatformException {
      return false;
    }
  }

  /// Whether notifications (incl. Android 13+ POST_NOTIFICATIONS) are allowed.
  static Future<bool> notificationsGranted() async {
    try {
      return await _channel.invokeMethod<bool>('notificationsGranted') ?? false;
    } on PlatformException {
      return false;
    }
  }

  /// Android 13+ runtime POST_NOTIFICATIONS prompt (no-op on older APIs).
  static Future<bool> requestPostNotifications() => _invokeBool(
        _channel.invokeMethod<bool>('requestPostNotifications'),
      );

  /// Deep-links to the system "display over other apps" page for this app.
  static Future<bool> openOverlaySettings() => _invokeBool(
        _channel.invokeMethod<bool>('openOverlaySettings'),
      );

  static Future<bool> requestBatteryWhitelist() => _invokeBool(
        _channel.invokeMethod<bool>('requestBatteryWhitelist'),
      );

  /// Opens brand-specific "auto start / background" settings.
  /// Returns false when no known vendor page could be launched.
  static Future<bool> openVendorBackgroundSettings() => _invokeBool(
        _channel.invokeMethod<bool>('openVendorBackgroundSettings'),
      );

  /// Opens Developer Options (on Xiaomi, the "USB debugging (Security
  /// settings)" page) so the user can allow ADB input injection — the
  /// permission that unlocks AI gesture control (tap/swipe/type).
  static Future<bool> openDeveloperSettings() => _invokeBool(
        _channel.invokeMethod<bool>('openDeveloperSettings'),
      );

  /// Who installed this build ("com.android.vending" = Google Play).
  static Future<String> installerPackage() async {
    try {
      return await _channel.invokeMethod<String>('installerPackage') ?? '';
    } on PlatformException {
      return '';
    } on MissingPluginException {
      return '';
    }
  }

  /// What Google Play says about a newer build for this install.
  ///
  /// Null means Play could not be asked (a sideloaded build has no Play), never
  /// a guess: the caller must treat null as "unknown", not "up to date".
  static Future<Map<String, Object?>?> playUpdateInfo() async {
    try {
      return await _channel.invokeMapMethod<String, Object?>('playUpdateInfo');
    } on PlatformException {
      return null;
    } on MissingPluginException {
      return null;
    }
  }

  /// Starts Play's own in-app update flow (immediate = full-screen, blocking).
  /// Returns "installed", "canceled", "failed" or "unavailable".
  static Future<String> startPlayUpdate() async {
    try {
      return await _channel
              .invokeMethod<String>('startPlayUpdate', {'type': 'immediate'})
              .timeout(const Duration(minutes: 10)) ??
          'failed';
    } on TimeoutException {
      return 'failed';
    } on PlatformException {
      return 'failed';
    } on MissingPluginException {
      return 'unavailable';
    }
  }


  static Future<({String name, int code})> appVersion() async {
    try {
      final v = await _channel.invokeMapMethod<String, Object?>('versionInfo');
      return (
        name: (v?['versionName'] as String?) ?? '0.0.0',
        code: (v?['versionCode'] as num?)?.toInt() ?? 0,
      );
    } on PlatformException {
      return (name: '0.0.0', code: 0);
    } on MissingPluginException {
      return (name: '0.0.0', code: 0);
    }
  }

  /// Hands a downloaded APK to the system installer (FileProvider + ACTION_VIEW).
  ///
  /// Returns a status string, never a bool:
  ///   * `"started"`          - the installer activity really opened.
  ///   * `"needs_permission"` - "Install unknown apps" is not granted to
  ///     ScreenSync (native opened that Settings page), or this build does not
  ///     declare REQUEST_INSTALL_PACKAGES at all (the Play flavor).
  ///   * `"error:<message>"`  - anything else, with a short reason.
  ///
  /// A native build that still answers with a bool is tolerated:
  /// `true` maps to `"started"`, `false` to an error.
  static Future<String> installApk(String path) async {
    try {
      final raw =
          await _channel.invokeMethod<Object?>('installApk', {'path': path});
      if (raw is String) return raw;
      if (raw is bool) {
        return raw ? 'started' : 'error:the installer could not be opened';
      }
      return 'error:no answer from the installer';
    } on PlatformException catch (e) {
      final why = e.message ?? e.code;
      return 'error:$why';
    } on MissingPluginException {
      return 'error:installer is not available in this build';
    }
  }

  /// Opens the Android share sheet for a captured frame (via FileProvider).
  /// Native copies the frame into `<cache>/share/` first: captures live in
  /// app_flutter, which no FileProvider root covers.
  static Future<bool> shareImage(String path) => _invokeBool(
        _channel.invokeMethod<bool>('shareImage', {'path': path}),
      );

  /// Opens the Android share sheet for any app file (via FileProvider, shared
  /// from `<cache>/share/`). [subject] pre-fills an email subject.
  static Future<bool> shareFile(
    String path, {
    String mimeType = 'application/octet-stream',
    String title = 'Share',
    String? subject,
  }) =>
      _invokeBool(
        _channel.invokeMethod<bool>('shareFile', {
          'path': path,
          'mimeType': mimeType,
          'title': title,
          if (subject != null) 'subject': subject,
        }),
      );

  /// Brings the ScreenSync activity to the foreground (used when a bubble
  /// long-press must show the full-screen region editor over another app).
  static Future<bool> bringAppToFront() => _invokeBool(
        _channel.invokeMethod<bool>('bringAppToFront'),
      );

  /// Shows an alert notification (live hub events: new diagnosis/patch).
  static Future<bool> postNotification(String title, String body) =>
      _invokeBool(
        _channel.invokeMethod<bool>(
            'postNotification', {'title': title, 'body': body}),
      );

  // ---- Keep-alive notification snap exchange ----

  static Future<int> pendingSnapCount() async {
    try {
      return await _channel.invokeMethod<int>('pendingSnapCount') ?? 0;
    } on PlatformException {
      return 0;
    }
  }

  /// Pops every queued notification-snap as PNG bytes then clears the queue.
  static Future<List<Uint8List>> drainPendingSnaps() async {
    try {
      final result =
          await _channel.invokeMethod<List<Object?>>('drainPendingSnaps') ??
              const [];
      return result.whereType<Uint8List>().toList();
    } on PlatformException {
      return const [];
    }
  }

  static Future<bool> _invokeBool(Future<bool?>? future) async {
    try {
      return await future ?? false;
    } on PlatformException {
      return false;
    }
  }
}
