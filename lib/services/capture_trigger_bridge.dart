import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// Outcome of one bubble capture request, written by the main engine and read
/// back by the overlay engine so the bubble can show what really happened.
class CaptureResult {
  const CaptureResult({required this.ok, this.path, this.error});
  final bool ok;
  final String? path;
  final String? error;
}

/// Filesystem bridge used by the overlay engine (separate Flutter isolate)
/// to signal the main engine. Each write is one JSON line event payload.
///
/// IMPORTANT: Directory.systemTemp is derived from the process TMPDIR and
/// therefore NOT stable across engines/processes here. All three sides
/// (overlay engine, main engine, Kotlin) must agree on ONE absolute path,
/// so the bridge uses <documents-dir>/screensync_capture_trigger (stable,
/// private, shared) instead of a temp-dir default. On Android
/// getApplicationDocumentsDirectory() is getDir("flutter", MODE_PRIVATE)
/// (<data>/app_flutter), and Kotlin's ScreenCaptureService.writeTriggerFile
/// writes its notification Snap/MCP payload to that exact directory. If you
/// change one side, change the other: a mismatch is silent, the notification
/// buttons just stop working.
///
/// BUG FIX: The [watch] stream is now cancellation-aware. The internal
/// polling loop exits when the stream subscription is cancelled, preventing
/// the "leaked infinite generator" issue where the loop kept running after
/// the BLoC called cancel() on its subscription.
class CaptureTriggerBridge {
  static const _fileName = 'screensync_capture_trigger';
  static const _latestFrameFileName = 'screensync_latest_frame';
  static const _resultFileName = 'screensync_capture_result';

  /// Payload prefix of the notification Snap action: `snap:<epochMillis>`. The
  /// timestamp makes every tap a different string, so the exact-payload dedupe
  /// in [watch] cannot swallow a second tap.
  static const snapPayloadPrefix = 'snap:';

  /// Same shape for the notification "MCP" action: `mcp:<epochMillis>`.
  static const mcpPayloadPrefix = 'mcp:';

  static String? _resolvedPath;
  static String? _resolvedDir;

  /// Explicit path override — set by [configure] / tests (suite-private
  /// files so parallel suites don't collide).
  static String? pathOverride;

  static File _file() =>
      File(pathOverride ?? _resolvedPath ?? 'data/$_fileName');

  /// Called at startup on BOTH engines: resolve a stable absolute path both
  /// sides agree on (app files dir; falls back to the engine temp dir).
  static Future<void> configure() async {
    if (pathOverride != null) return;
    try {
      final dir = await getApplicationDocumentsDirectory();
      _resolvedDir = dir.path;
      _resolvedPath = '${dir.path}/$_fileName';
    } catch (_) {
      _resolvedDir = Directory.systemTemp.path;
      _resolvedPath = '${Directory.systemTemp.path}/$_fileName';
    }
  }

  /// Result file for capture requests. Suite-private next to the trigger file
  /// when [pathOverride] is set, so parallel test suites never read each
  /// other's answers; the shared app-files location otherwise.
  static Future<File> _resultFile() async => pathOverride != null
      ? File('$pathOverride.result')
      : File('${await _dir()}/$_resultFileName');

  static Future<String> _dir() async {
    if (pathOverride != null) return File(pathOverride!).parent.path;
    if (_resolvedDir == null) await configure();
    return _resolvedDir ?? Directory.systemTemp.path;
  }

  /// Main engine writes the newest frame path; overlay engine reads it for
  /// the thumbnail peek. Best-effort on both sides.
  static Future<void> writeLatestFramePointer(String framePath) async {
    try {
      await File('${await _dir()}/$_latestFrameFileName')
          .writeAsString(framePath, flush: true);
    } catch (_) {/* peek is optional */}
  }

  static Future<String?> readLatestFramePointer() async {
    try {
      final file = File('${await _dir()}/$_latestFrameFileName');
      if (!await file.exists()) return null;
      final path = (await file.readAsString()).trim();
      return path.isEmpty ? null : path;
    } catch (_) {
      return null;
    }
  }

  /// Main engine -> overlay engine: how the capture request [nonce] ended.
  /// Best-effort; the bubble falls back to a timeout if this never lands.
  static Future<void> writeCaptureResult(
    Object nonce, {
    required bool ok,
    String? path,
    String? error,
  }) async {
    try {
      await (await _resultFile()).writeAsString(
        jsonEncode({
          'nonce': nonce,
          'ok': ok,
          if (path != null) 'path': path,
          if (error != null) 'error': error,
        }),
        flush: true,
      );
    } catch (_) {/* result is optional */}
  }

  /// Overlay engine: waits for the result of request [nonce]. Returns null on
  /// [timeout] (the main engine is not running, or the trigger was lost). A
  /// result left by an earlier request has a different nonce and is ignored.
  static Future<CaptureResult?> awaitCaptureResult(
    Object nonce, {
    Duration timeout = const Duration(seconds: 15),
    Duration interval = const Duration(milliseconds: 120),
  }) async {
    final deadline = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(deadline)) {
      try {
        final file = await _resultFile();
        if (await file.exists()) {
          final decoded = jsonDecode(await file.readAsString());
          if (decoded is Map<String, dynamic> &&
              '${decoded['nonce']}' == '$nonce') {
            return CaptureResult(
              ok: decoded['ok'] == true,
              path: decoded['path'] as String?,
              error: decoded['error'] as String?,
            );
          }
        }
      } catch (_) {/* transient IO race between engines */}
      await Future<void>.delayed(interval);
    }
    return null;
  }

  static Future<void> send(Map<String, Object?> event) async {
    await _file().writeAsString(jsonEncode(event), flush: true);
  }

  /// Returns a stream of JSON events written by the overlay engine.
  ///
  /// The loop polls every [interval] and terminates cleanly when the
  /// returned stream's subscription is cancelled (e.g. in BLoC.close()).
  static Stream<Map<String, Object?>> watch({
    Duration interval = const Duration(milliseconds: 200),
  }) {
    // Use a StreamController so cancellation is handled via onCancel.
    late StreamController<Map<String, Object?>> controller;
    String? lastPayload;
    bool active = false;

    /// A trigger left in the file by an earlier session is history, not a
    /// request: replaying it on start would fire a phantom capture (a stale
    /// notification Snap, or a bubble tap from before the app restarted).
    String? readCurrentSync() {
      try {
        final file = _file();
        return file.existsSync() ? file.readAsStringSync() : null;
      } catch (_) {
        return null;
      }
    }

    // Raw notification payloads (not JSON): `snap:<epochMillis>` for the Snap
    // action, `mcp:<epochMillis>` for the MCP action.
    Map<String, Object?>? fromRaw(String raw) {
      for (final (prefix, source) in const [
        (snapPayloadPrefix, 'SNAP'),
        (mcpPayloadPrefix, 'MCP'),
      ]) {
        if (raw.startsWith(prefix)) {
          return <String, Object?>{
            'type': 'NOTIFICATION_SNAP',
            'source': source,
            'payload': raw.trim(),
          };
        }
      }
      return null;
    }

    Map<String, Object?>? decode(String payload) {
      final raw = fromRaw(payload);
      if (raw != null) return raw;
      final decoded = jsonDecode(payload);
      if (decoded is Map<String, dynamic>) {
        return Map<String, Object?>.from(decoded);
      }
      // The same raw payload, JSON-quoted.
      return decoded is String ? fromRaw(decoded) : null;
    }

    Future<void> poll() async {
      while (active) {
        await Future<void>.delayed(interval);
        if (!active) break;
        final file = _file();
        try {
          if (!await file.exists()) continue;
          final payload = await file.readAsString();
          // Dedupe on the exact payload string: a repeat of the same bytes is
          // not a new request; anything that differs (nonce, timestamp) is.
          if (payload.isEmpty || payload == lastPayload) continue;
          lastPayload = payload;
          final event = decode(payload);
          if (event != null && active) controller.add(event);
        } catch (_) {/* transient IO race between engines */}
      }
    }

    controller = StreamController<Map<String, Object?>>(
      onListen: () {
        active = true;
        lastPayload = readCurrentSync();
        poll();
      },
      onCancel: () {
        active = false;
      },
    );

    return controller.stream;
  }

  /// Each payload carries a unique nonce so the watcher's identical-payload
  /// dedupe never swallows rapid repeat taps.
  static Map<String, Object?> _nonce() =>
      {'nonce': DateTime.now().microsecondsSinceEpoch};

  /// Returns the request nonce so the caller can wait for the matching
  /// [CaptureResult] via [awaitCaptureResult].
  static Future<int> sendCapture({String source = 'floating_bubble'}) async {
    final nonce = DateTime.now().microsecondsSinceEpoch;
    await send({'type': 'CAPTURE', 'source': source, 'nonce': nonce});
    return nonce;
  }

  /// Long-press on the bubble: capture the full frame, then open the
  /// full-screen crop editor in the main app (reliable across all OEMs,
  /// unlike resizing the size-capped overlay window).
  static Future<void> sendRegionCapture({String source = 'floating_bubble'}) =>
      send({'type': 'REGION_CAPTURE', 'source': source, ..._nonce()});

  static Future<void> sendCrop(double nx, double ny, double nw, double nh) =>
      send({
        'type': 'CROP_CAPTURE',
        'rect': {'nx': nx, 'ny': ny, 'nw': nw, 'nh': nh},
        ..._nonce(),
      });
}
