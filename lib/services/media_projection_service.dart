import 'dart:async';

import 'package:flutter/services.dart';

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

  static Future<Uint8List> captureScreen() async {
    final bytes = await _channel.invokeMethod<Uint8List>('captureScreen');
    if (bytes == null || bytes.isEmpty) {
      throw PlatformException(
        code: 'empty_capture',
        message: 'Android returned an empty screen capture.',
      );
    }
    return bytes;
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
