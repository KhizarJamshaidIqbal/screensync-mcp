import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// Filesystem bridge used by the overlay engine (separate Flutter isolate)
/// to signal the main engine. Each write is one JSON line event payload.
///
/// IMPORTANT: Directory.systemTemp is derived from the process TMPDIR and
/// therefore NOT stable across engines/processes here, and Kotlin's
/// notification-trigger writes land in context.cacheDir. All three sides
/// (overlay engine, main engine, Kotlin) must agree on ONE absolute path,
/// so the bridge uses <app-files>/screensync_capture_trigger (stable,
/// private, shared) instead of a temp-dir default.
///
/// BUG FIX: The [watch] stream is now cancellation-aware. The internal
/// polling loop exits when the stream subscription is cancelled, preventing
/// the "leaked infinite generator" issue where the loop kept running after
/// the BLoC called cancel() on its subscription.
class CaptureTriggerBridge {
  static const _fileName = 'screensync_capture_trigger';
  static const _latestFrameFileName = 'screensync_latest_frame';
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

    Future<void> poll() async {
      while (active) {
        await Future<void>.delayed(interval);
        if (!active) break;
        final file = _file();
        try {
          if (!await file.exists()) continue;
          final payload = await file.readAsString();
          if (payload.isEmpty || payload == lastPayload) continue;
          lastPayload = payload;
          final decoded = jsonDecode(payload);
          if (decoded is Map<String, dynamic> && active) {
            controller.add(Map<String, Object?>.from(decoded));
          }
        } catch (_) {/* transient IO race between engines */}
      }
    }

    controller = StreamController<Map<String, Object?>>(
      onListen: () {
        active = true;
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

  static Future<void> sendCapture({String source = 'floating_bubble'}) =>
      send({'type': 'CAPTURE', 'source': source, ..._nonce()});

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
