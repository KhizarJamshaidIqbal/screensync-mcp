import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/capture_quality.dart';
import '../models/telemetry_event.dart';

/// Durable app-wide settings. Run [init] once per engine before first read.
class SettingsService extends ChangeNotifier {
  SettingsService._();
  static final SettingsService instance = SettingsService._();

  late SharedPreferences _prefs;

  static const _kThemeMode = 'theme_mode';
  static const _kHubOverride = 'hub_url_override';
  static const _kToken = 'pairing_token';
  static const _kQuality = 'default_quality';
  static const _kShakeEnabled = 'shake_enabled';
  static const _kShakeThreshold = 'shake_threshold';
  static const _kSyncMode = 'sync_mode';
  static const _kAutoDiscover = 'auto_discover_hub';
  static const _kAutoSync = 'auto_sync_pending';
  static const _kVendorConfirmed = 'vendor_bg_confirmed';
  static const _kGestureConfirmed = 'gesture_control_confirmed';
  static const _kConnectKitDismissed = 'connect_kit_dismissed';
  static const _kTelemetry = 'telemetry_log';
  static const _kOnboardingDone = 'onboarding_done';
  static const _kSimpleMode = 'simple_mode';
  static const _kAccentColor = 'accent_color_index';
  static const _kAmoledDark = 'amoled_dark';
  static const _kRedaction = 'redaction_enabled';
  static const _kCustomPresets = 'custom_presets';
  static const _kActivePreset = 'active_preset_id';
  static const _kRegionFavorites = 'region_favorites';

  Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
  }

  ThemeMode get themeMode => ThemeMode.values[_prefs.getInt(_kThemeMode) ?? 0];
  set themeMode(ThemeMode mode) {
    _prefs.setInt(_kThemeMode, mode.index);
    notifyListeners();
  }

  /// Empty string means "use build-time dart-define value".
  String get hubUrlOverride => _prefs.getString(_kHubOverride) ?? '';
  set hubUrlOverride(String url) {
    _prefs.setString(_kHubOverride, url.trim());
    notifyListeners();
  }

  String get pairingToken =>
      _prefs.getString(_kToken) ?? 'screensync-local-dev';
  set pairingToken(String token) {
    _prefs.setString(_kToken, token.trim());
    notifyListeners();
  }

  CaptureQuality get defaultQuality {
    final i = _prefs.getInt(_kQuality);
    return i == null
        ? CaptureQuality.fast
        : CaptureQuality.values[i.clamp(0, CaptureQuality.values.length - 1)];
  }

  set defaultQuality(CaptureQuality q) {
    _prefs.setInt(_kQuality, q.index);
    notifyListeners();
  }

  bool get shakeEnabled => _prefs.getBool(_kShakeEnabled) ?? false;
  set shakeEnabled(bool v) {
    _prefs.setBool(_kShakeEnabled, v);
    notifyListeners();
  }

  double get shakeThreshold => _prefs.getDouble(_kShakeThreshold) ?? 14.0;
  set shakeThreshold(double v) {
    _prefs.setDouble(_kShakeThreshold, v);
    notifyListeners();
  }

  int get syncModeIndex => _prefs.getInt(_kSyncMode) ?? 2;
  set syncModeIndex(int i) {
    _prefs.setInt(_kSyncMode, i);
    notifyListeners();
  }

  /// Automatically mDNS-discover and connect to the hub (zero manual config).
  bool get autoDiscover => _prefs.getBool(_kAutoDiscover) ?? true;
  set autoDiscover(bool v) {
    _prefs.setBool(_kAutoDiscover, v);
    notifyListeners();
  }

  /// Automatically push pending frames whenever the hub becomes reachable.
  /// Whether the user dismissed the dashboard "Connect an AI agent" card.
  bool get connectKitDismissed => _prefs.getBool(_kConnectKitDismissed) ?? false;
  set connectKitDismissed(bool v) {
    _prefs.setBool(_kConnectKitDismissed, v);
    notifyListeners();
  }

  /// User-acknowledged "vendor auto-start/background" step (undetectable).
  bool get vendorConfirmed => _prefs.getBool(_kVendorConfirmed) ?? false;
  set vendorConfirmed(bool v) {
    _prefs.setBool(_kVendorConfirmed, v);
    notifyListeners();
  }

  /// User-acknowledged "USB debugging (Security) / ADB input injection" step.
  /// Undetectable from inside the app (it's a system-level ADB grant), so we
  /// track it as a manual acknowledgement like the vendor step.
  bool get gestureControlConfirmed =>
      _prefs.getBool(_kGestureConfirmed) ?? false;
  set gestureControlConfirmed(bool v) {
    _prefs.setBool(_kGestureConfirmed, v);
    notifyListeners();
  }

  bool get autoSync => _prefs.getBool(_kAutoSync) ?? true;
  set autoSync(bool v) {
    _prefs.setBool(_kAutoSync, v);
    notifyListeners();
  }

  /// First-run onboarding wizard completed (or skipped).
  bool get onboardingDone => _prefs.getBool(_kOnboardingDone) ?? false;
  set onboardingDone(bool v) {
    _prefs.setBool(_kOnboardingDone, v);
    notifyListeners();
  }

  /// Simple mode hides developer surfaces (MCP, telemetry, tokens, patches).
  bool get simpleMode => _prefs.getBool(_kSimpleMode) ?? false;
  set simpleMode(bool v) {
    _prefs.setBool(_kSimpleMode, v);
    notifyListeners();
  }

  // ── Theming (E3) ──

  /// Index into [AppAccent.palette]; 0 = default violet.
  int get accentColorIndex => _prefs.getInt(_kAccentColor) ?? 0;
  set accentColorIndex(int i) {
    _prefs.setInt(_kAccentColor, i);
    notifyListeners();
  }

  /// True-black dark variant for AMOLED displays.
  bool get amoledDark => _prefs.getBool(_kAmoledDark) ?? false;
  set amoledDark(bool v) {
    _prefs.setBool(_kAmoledDark, v);
    notifyListeners();
  }

  // ── Privacy redaction (C2) ──

  /// Opt-in: blur/pixelate frames before they leave the device.
  bool get redactionEnabled => _prefs.getBool(_kRedaction) ?? false;
  set redactionEnabled(bool v) {
    _prefs.setBool(_kRedaction, v);
    notifyListeners();
  }

  // ── Custom capture presets (C1) ──

  /// Raw JSON strings of user-defined presets (parsed by CustomPreset).
  List<String> get customPresetsRaw =>
      _prefs.getStringList(_kCustomPresets) ?? const [];
  set customPresetsRaw(List<String> v) {
    _prefs.setStringList(_kCustomPresets, v);
    notifyListeners();
  }

  /// Id of the active custom preset ('' = use built-in quality preset).
  String get activeCustomPresetId => _prefs.getString(_kActivePreset) ?? '';
  set activeCustomPresetId(String id) {
    _prefs.setString(_kActivePreset, id);
    notifyListeners();
  }

  // ── Region favorites (C3) ──

  List<String> get regionFavoritesRaw =>
      _prefs.getStringList(_kRegionFavorites) ?? const [];
  set regionFavoritesRaw(List<String> v) {
    _prefs.setStringList(_kRegionFavorites, v);
    notifyListeners();
  }

  List<TelemetryEvent> get telemetryLog {
    final raw = _prefs.getStringList(_kTelemetry) ?? const [];
    final events = <TelemetryEvent>[];
    for (final entry in raw) {
      try {
        final decoded = jsonDecode(entry);
        if (decoded is Map<String, dynamic>) {
          events.add(TelemetryEvent.fromJson(decoded));
        }
      } catch (_) {/* skip corrupt rows */}
    }
    return events;
  }

  void appendTelemetry(TelemetryEvent event) {
    final log = telemetryLog..insert(0, event);
    if (log.length > TelemetryEvent.maxStored) {
      log.removeRange(TelemetryEvent.maxStored, log.length);
    }
    _prefs.setStringList(
        _kTelemetry, log.map((e) => jsonEncode(e.toJson())).toList());
    notifyListeners();
  }

  void clearTelemetry() {
    _prefs.remove(_kTelemetry);
    notifyListeners();
  }
}
