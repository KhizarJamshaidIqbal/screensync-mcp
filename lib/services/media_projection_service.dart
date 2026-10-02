import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../models/capture_quality.dart';
import 'capture_pipeline_service.dart';

/// The picture the native capture service handed back.
class ProjectionCapture {
  const ProjectionCapture(
    this.bytes, {
    required this.processed,
    this.mimeType = 'image/png',
  });

  final Uint8List bytes;

  /// True when Kotlin already applied the crop, the width limit and the encoding
  /// that was asked for, so [bytes] are final. False for a bare full-resolution
  /// PNG, which [CapturePipeline.process] still has to turn into the preset.
  final bool processed;

  final String mimeType;
}

/// A capture asked for while the user has paused captures. Its text is shown
/// to the user as is (a StateError would read "Bad state: ...").
class CapturePausedException implements Exception {
  const CapturePausedException();

  @override
  String toString() => 'Capture is paused. Resume it in Capture controls.';
}

class MediaProjectionService {
  static const _channel = MethodChannel(
    'com.screensync.mcp/media_projection',
  );

  /// Emits `true` while a MediaProjection session is live and capture works,
  /// `false` once it ended or never started. Native side: current value on
  /// listen, then every change (projection started, `onStop`, service gone).
  static const _stateChannel = EventChannel(
    'com.screensync.mcp/projection_state',
  );

  /// Longest [prepare] waits for the consent flow. The native side gives up
  /// after 60 s with `permission_timeout`; this is the Dart-side safety net so
  /// a consent Activity that never opens can never hang a caller forever.
  static const prepareTimeout = Duration(seconds: 70);

  /// Asks for screen-capture consent (unless a session is already live) and
  /// waits until the capture service is ready.
  ///
  /// Returns `true` when capture is ready, `false` when the user refused or the
  /// consent prompt timed out (native `permission_timeout` or [timeout]).
  /// Other native failures (for example `permission_request_active`, meaning a
  /// consent prompt is already open) still throw a [PlatformException].
  static Future<bool> prepare({Duration timeout = prepareTimeout}) async {
    try {
      return await _prepare().timeout(timeout);
    } on TimeoutException {
      return false;
    } on PlatformException catch (e) {
      if (e.code == 'permission_timeout') return false;
      rethrow;
    }
  }

  static Future<bool> _prepare() async {
    final granted =
        await _channel.invokeMethod<bool>('prepareCapture') ?? false;
    if (!granted) return false;

    final deadline = DateTime.now().add(const Duration(seconds: 5));
    while (DateTime.now().isBefore(deadline)) {
      if (await isReady()) return true;
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
    throw PlatformException(
      code: 'projection_start_timeout',
      message: 'Screen capture service did not become ready in time.',
    );
  }

  static Future<bool> isReady() async {
    return await _channel.invokeMethod<bool>('isCaptureReady') ?? false;
  }

  /// Live projection state (see [_stateChannel]). Errors are swallowed so a
  /// build whose native side predates the channel simply never emits; callers
  /// also poll [isReady] as a fallback.
  static Stream<bool> get stateStream => _stateChannel
      .receiveBroadcastStream()
      .map((event) => event == true)
      .handleError((Object _) {});

  /// What the native `captureScreen` call is asked to produce for [quality]
  /// (and [crop], as fractions of the frame). Kotlin crops, scales and encodes,
  /// so a JPEG preset never makes a full-resolution PNG first. `inspection`
  /// leaves out `maxWidth`: native resolution.
  @visibleForTesting
  static Map<String, Object?> captureArguments(
    CaptureQuality quality, {
    NormRect? crop,
  }) =>
      {
        'format': quality == CaptureQuality.inspection ? 'png' : 'jpeg',
        if (quality.maxWidthPreset != null) 'maxWidth': quality.maxWidthPreset,
        if (quality != CaptureQuality.inspection)
          'jpegQuality': quality.jpegQuality,
        if (crop != null)
          'crop': {'x': crop.nx, 'y': crop.ny, 'w': crop.nw, 'h': crop.nh},
      };

  /// Grabs the screen as [quality] (and [crop]) describes. A native side that
  /// does the encoding replies with a finished picture ([ProjectionCapture.processed]);
  /// a bare PNG reply still needs [CapturePipeline.process].
  static Future<ProjectionCapture> captureScreen({
    CaptureQuality quality = CaptureQuality.inspection,
    NormRect? crop,
  }) async {
    final reply = await _channel.invokeMethod<Object?>(
      'captureScreen',
      captureArguments(quality, crop: crop),
    );
    final capture = switch (reply) {
      final Uint8List bytes => ProjectionCapture(bytes, processed: false),
      {'bytes': final Uint8List bytes, 'format': final Object? format} =>
        ProjectionCapture(
          bytes,
          processed: true,
          mimeType: format == 'jpeg' ? 'image/jpeg' : 'image/png',
        ),
      _ => null,
    };
    if (capture == null || capture.bytes.isEmpty) {
      throw PlatformException(
        code: 'empty_capture',
        message: 'Android returned an empty screen capture.',
      );
    }
    return capture;
  }

  static Future<void> stop() => _channel.invokeMethod<void>('stopCapture');

  /// Sets pause (with or without a capture session) and returns the state the
  /// capture service now holds.
  static Future<bool> setPaused(bool paused) async =>
      await _channel.invokeMethod<bool>('pauseCapture', {'paused': paused}) ??
      await isPaused();

  /// Whether the user paused captures. Capture paths ask this before they act,
  /// so a native side that cannot answer counts as "not paused" rather than
  /// failing the capture.
  static Future<bool> isPaused() async {
    try {
      return await _channel.invokeMethod<bool>('isPaused') ?? false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }
}
