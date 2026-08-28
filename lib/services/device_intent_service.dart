import 'package:flutter/services.dart';

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

  /// Opens the Android share sheet for a captured frame (via FileProvider).
  static Future<bool> shareImage(String path) => _invokeBool(
        _channel.invokeMethod<bool>('shareImage', {'path': path}),
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
