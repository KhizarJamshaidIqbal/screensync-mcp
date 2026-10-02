import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../models/bug_region.dart';
import '../models/capture_quality.dart';
import '../models/captured_frame.dart';
import '../models/mcp_catalog.dart';
import '../services/capture_pipeline_service.dart';
import '../services/floating_overlay_service.dart';
import '../services/media_projection_service.dart';
import 'google_drive_repository.dart';

/// Outcome of the authenticated hub probe ([ScreenRepository.checkHubAuth]).
/// `/health` is unauthenticated, so a reachable hub says nothing about whether
/// this phone's token is accepted.
enum HubAuthStatus { ok, rejected, unknown }

/// Central data access. Resolves hub URL/token from Settings (runtime)
/// falling back to build-time dart-defines, so LAN sync works on real
/// devices without a rebuild once an address is picked or discovered.
class ScreenRepository {
  static const _hubUrlDefine = String.fromEnvironment(
    'SCREEN_SYNC_HUB_URL',
    defaultValue: 'http://127.0.0.1:3000',
  );
  static const _pairingTokenDefine = String.fromEnvironment(
    'SCREEN_SYNC_TOKEN',
    defaultValue: 'screensync-local-dev',
  );

  final GoogleDriveRepository _driveRepo = GoogleDriveRepository();

  /// Hub URL found via mDNS auto-discovery (below manual override, above
  /// the build-time default in the resolution chain).
  String _autoHubUrl = '';
  void setAutoHubUrl(String url) => _autoHubUrl = url;

  /// Set by the Bloc so every repo call emits telemetry.
  void Function({
    required String kind,
    required String label,
    required int durationMs,
    required bool ok,
  })? onTelemetry;

  String get hubUrl => _resolveHubUrl();
  String get pairingToken => _resolveToken();

  // Overridable via bloc; avoids importing SettingsService here to keep
  // repository dependencies injection-friendly.
  String Function()? hubUrlResolver;
  String Function()? tokenResolver;

  /// Which tier of the resolution chain is active: manual > mdns > default.
  String get hubSource {
    final override = hubUrlResolver?.call() ?? '';
    if (override.isNotEmpty) return 'manual';
    if (_autoHubUrl.isNotEmpty) return 'mdns';
    return 'default';
  }

  String _resolveHubUrl() {
    final override = hubUrlResolver?.call() ?? '';
    if (override.isNotEmpty) return override;
    if (_autoHubUrl.isNotEmpty) return _autoHubUrl;
    return _hubUrlDefine;
  }

  String _resolveToken() {
    final resolved = tokenResolver?.call().trim();
    // An empty token would go out as "Bearer " and be refused; treat it as unset.
    return (resolved == null || resolved.isEmpty)
        ? _pairingTokenDefine
        : resolved;
  }

  Uri _endpoint(String path) => Uri.parse('${_resolveHubUrl()}$path');

  Map<String, String> _authHeaders({bool json = true}) => {
        if (json) 'Content-Type': 'application/json',
        'Authorization': 'Bearer ${_resolveToken()}',
      };

  /// Requests Android screen-capture consent, then starts the floating bubble.
  Future<bool> initializeOverlayAndProjection() async {
    final projectionReady = await MediaProjectionService.prepare();
    if (!projectionReady) return false;

    final overlayStarted = await FloatingOverlayService.showOverlayBubble();
    if (!overlayStarted) await MediaProjectionService.stop();
    return overlayStarted;
  }

  Future<void> stopOverlay() async {
    await FloatingOverlayService.closeOverlayBubble();
    await MediaProjectionService.stop();
  }

  /// Captures the current display and applies pipeline preset / crop region.
  ///
  /// [allowPrompt] false is for background callers (the live-mirror timer): they
  /// must never raise the consent dialog, so a session that is not live throws
  /// instead of calling `prepare()`.
  Future<CapturedFrame> captureCurrentDisplay({
    CaptureQuality quality = CaptureQuality.inspection,
    NormRect? crop,
    bool allowPrompt = true,
  }) async {
    // The service refuses every frame while paused, so don't raise the consent
    // dialog (or start a session) for a capture that is going to fail anyway.
    if (await MediaProjectionService.isPaused()) {
      throw const CapturePausedException();
    }
    if (!await MediaProjectionService.isReady()) {
      if (!allowPrompt) {
        throw StateError('Screen capture is not active.');
      }
      final ready = await MediaProjectionService.prepare();
      if (!ready) {
        throw StateError('Screen capture permission was not granted.');
      }
    }
    final capture = await MediaProjectionService.captureScreen(
      quality: quality,
      crop: crop,
    );
    // Kotlin crops, scales and encodes: nothing is left to decode and re-encode here.
    if (capture.processed) {
      return CapturedFrame(
          imageBytes: capture.bytes, mimeType: capture.mimeType);
    }
    final bytes =
        await CapturePipeline.process(capture.bytes, quality, crop: crop);
    return CapturedFrame(imageBytes: bytes, mimeType: quality.mime);
  }

  /// Liveness probe with a short window — used by fail-fast UI checks.
  Future<bool> pingHub({Duration timeout = const Duration(seconds: 2)}) async =>
      (await pingHubTimed(timeout: timeout)).ok;

  /// Liveness probe plus round-trip latency for the connection indicator.
  Future<({bool ok, int ms})> pingHubTimed(
      {Duration timeout = const Duration(seconds: 2)}) async {
    final watch = Stopwatch()..start();
    try {
      final response = await http.get(_endpoint('/health')).timeout(timeout);
      watch.stop();
      final ok = response.statusCode >= 200 && response.statusCode < 300;
      return (ok: ok, ms: watch.elapsedMilliseconds);
    } catch (_) {
      watch.stop();
      return (ok: false, ms: watch.elapsedMilliseconds);
    }
  }

  /// One authenticated round trip (`/api/events/recent`, the lightest bearer-
  /// guarded hub route). A 401/403 means the hub is up but rejects this phone's
  /// token; anything inconclusive (timeout, 5xx) is [HubAuthStatus.unknown] so a
  /// flaky network never shows up as an auth problem.
  Future<HubAuthStatus> checkHubAuth(
      {Duration timeout = const Duration(seconds: 3)}) async {
    try {
      final res = await http
          .get(_endpoint('/api/events/recent?limit=1'),
              headers: _authHeaders(json: false))
          .timeout(timeout);
      if (res.statusCode == 401 || res.statusCode == 403) {
        return HubAuthStatus.rejected;
      }
      if (res.statusCode >= 200 && res.statusCode < 300) {
        return HubAuthStatus.ok;
      }
      return HubAuthStatus.unknown;
    } catch (_) {
      return HubAuthStatus.unknown;
    }
  }

  static const _fallbackDeviceModel = 'Android MediaProjection';
  String? _deviceModelCache;

  /// Loads the real handset model; tests swap this out.
  @visibleForTesting
  Future<String> Function() deviceModelLoader = _loadDeviceModel;

  static Future<String> _loadDeviceModel() async {
    try {
      final info = await DeviceInfoPlugin().androidInfo;
      final model = info.model.trim();
      if (model.isNotEmpty) return model;
    } catch (_) {/* not Android / plugin unavailable: use the fallback */}
    return _fallbackDeviceModel;
  }

  Future<String> _deviceModel() async =>
      _deviceModelCache ??= await deviceModelLoader();

  /// Push frame to local MCP server over LAN.
  ///
  /// FIX: never throws for connectivity problems — returns `false` so the
  /// hybrid fallback path in the Bloc actually executes. Only a *reached but
  /// refused* request (`[refusal]`) surfaces as thrown detail via return pair.
  Future<bool> pushToLocalMcpServer(CapturedFrame frame) async {
    final watch = Stopwatch()..start();
    try {
      final deviceModel = await _deviceModel();
      final response = await http
          .post(
            _endpoint('/api/screens/upload'),
            headers: _authHeaders(),
            body: jsonEncode({
              'imageDataUrl':
                  'data:${frame.mimeType};base64,${base64Encode(frame.imageBytes)}',
              'filename': frame.filename,
              'timestamp': frame.timestamp.toIso8601String(),
              'deviceModel': deviceModel,
              'screenResolution': {
                'width': frame.width,
                'height': frame.height
              },
            }),
          )
          .timeout(const Duration(seconds: 8));
      watch.stop();

      if (response.statusCode < 200 || response.statusCode >= 300) {
        onTelemetry?.call(
          kind: 'upload',
          label: 'Hub refused (${response.statusCode})',
          durationMs: watch.elapsedMilliseconds,
          ok: false,
        );
        return false;
      }
      onTelemetry?.call(
        kind: 'upload',
        label: 'LAN push ${frame.filename} (${frame.sizeLabel})',
        durationMs: watch.elapsedMilliseconds,
        ok: true,
      );
      return true;
    } on TimeoutException {
      onTelemetry?.call(
          kind: 'upload',
          label: 'Hub unreachable (timeout)',
          durationMs: watch.elapsedMilliseconds,
          ok: false);
      return false;
    } on SocketException {
      onTelemetry?.call(
          kind: 'upload',
          label: 'Hub unreachable (${_resolveHubUrl()})',
          durationMs: watch.elapsedMilliseconds,
          ok: false);
      return false;
    } on HttpException {
      onTelemetry?.call(
          kind: 'upload',
          label: 'HTTP transport failure',
          durationMs: watch.elapsedMilliseconds,
          ok: false);
      return false;
    }
  }

  Future<void> uploadToGoogleDrive(CapturedFrame frame) async {
    final watch = Stopwatch()..start();
    try {
      await _driveRepo.uploadScreenshot(
          imageBytes: frame.imageBytes, filename: frame.filename);
      watch.stop();
      onTelemetry?.call(
          kind: 'upload',
          label: 'Drive upload ${frame.filename}',
          durationMs: watch.elapsedMilliseconds,
          ok: true);
    } catch (e) {
      watch.stop();
      onTelemetry?.call(
          kind: 'upload',
          label: 'Drive upload failed: $e',
          durationMs: watch.elapsedMilliseconds,
          ok: false);
      rethrow;
    }
  }

  /// Desktop inspection outputs for the Heatmap preview tab.
  Future<List<BugRegion>> fetchBugRegions() async {
    final res = await http
        .get(_endpoint('/api/inspections/latest'),
            headers: _authHeaders(json: false))
        .timeout(const Duration(seconds: 3));
    if (res.statusCode == 404) return const [];
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw StateError('inspections endpoint ${res.statusCode}');
    }
    final decoded = jsonDecode(utf8.decode(res.bodyBytes));
    final list = decoded is Map<String, dynamic>
        ? (decoded['bugs'] as List<dynamic>? ?? const [])
        : const [];
    return list
        .whereType<Map<String, dynamic>>()
        .map(BugRegion.fromJson)
        .toList();
  }

  /// Full MCP capability catalog (tools/skills/resources + connection info)
  /// served by the desktop hub; powers the in-app MCP page.
  Future<McpCatalog> fetchMcpCatalog() async {
    final res = await http
        .get(_endpoint('/api/mcp/catalog'), headers: _authHeaders(json: false))
        .timeout(const Duration(seconds: 3));
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw StateError('catalog endpoint ${res.statusCode}');
    }
    final decoded = jsonDecode(utf8.decode(res.bodyBytes));
    return McpCatalog.fromJson(decoded as Map<String, dynamic>);
  }

  /// Latest Claude-generated git patch waiting on the desktop.
  Future<Map<String, dynamic>?> fetchLatestPatch() async {
    final res = await http
        .get(_endpoint('/api/patches/latest'),
            headers: _authHeaders(json: false))
        .timeout(const Duration(seconds: 3));
    if (res.statusCode == 404) return null;
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw StateError('patch endpoint ${res.statusCode}');
    }
    return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
  }

  /// D1: in-app MCP tool runner. Maps a catalog tool name onto the hub's
  /// HTTP surface and returns the pretty-printed JSON result. Tools that
  /// only exist over stdio return an explanatory message instead of failing.
  Future<String> runCatalogTool(String name,
      {Map<String, dynamic> args = const {}}) async {
    Future<String> get(String path) async {
      final res = await http
          .get(_endpoint(path), headers: _authHeaders(json: false))
          .timeout(const Duration(seconds: 8));
      return _prettyJson(res.body, res.statusCode);
    }

    Future<String> post(String path, Map<String, dynamic> body) async {
      final res = await http
          .post(_endpoint(path),
              headers: _authHeaders(), body: jsonEncode(body))
          .timeout(const Duration(seconds: 12));
      return _prettyJson(res.body, res.statusCode);
    }

    switch (name) {
      case 'get_latest_screenshot':
        return get('/api/screens/latest');
      case 'get_device_status':
        return get('/api/device/status');
      case 'get_mcp_catalog':
        return get('/api/mcp/catalog');
      case 'list_recent_screens':
      case 'get_recent_screenshots':
        return get('/api/screens/latest');
      case 'publish_inspection':
        return get('/api/inspections/latest');
      case 'publish_patch':
        return get('/api/patches/latest');
      default:
        if (name.startsWith('control_')) {
          return post('/api/control/${name.substring(8)}', args);
        }
        return jsonEncode({
          'note': 'Tool "$name" is stdio-only — run it from an MCP client '
              '(Claude Code / Desktop) connected via the Connect Kit.',
        });
    }
  }

  String _prettyJson(String body, int status) {
    try {
      final decoded = jsonDecode(body);
      // Truncate giant base64 image payloads so the UI stays responsive.
      if (decoded is Map<String, dynamic>) {
        for (final key in ['imageDataUrl']) {
          final v = decoded[key];
          if (v is String && v.length > 200) {
            decoded[key] = '${v.substring(0, 120)}… (${v.length} chars)';
          }
        }
      }
      return const JsonEncoder.withIndent('  ').convert({
        'httpStatus': status,
        'result': decoded,
      });
    } catch (_) {
      return 'HTTP $status\n$body';
    }
  }

  Future<Map<String, dynamic>?> fetchDeviceStatus() async {
    try {
      final res = await http
          .get(_endpoint('/api/device/status'),
              headers: _authHeaders(json: false))
          .timeout(const Duration(seconds: 2));
      if (res.statusCode < 200 || res.statusCode >= 300) return null;
      return jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }
}
