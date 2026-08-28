import 'dart:async';

import 'package:flutter/services.dart';

class MediaProjectionService {
  static const _channel = MethodChannel(
    'com.screensync.mcp/media_projection',
  );

  static Future<bool> prepare() async {
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

  static Future<void> setPaused(bool paused) =>
      _channel.invokeMethod<void>('pauseCapture', {'paused': paused});

  static Future<bool> isPaused() async =>
      await _channel.invokeMethod<bool>('isPaused') ?? false;
}
