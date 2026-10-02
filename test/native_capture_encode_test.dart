import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;

import 'package:screensync_flutter_project/models/capture_quality.dart';
import 'package:screensync_flutter_project/repositories/screen_repository.dart';
import 'package:screensync_flutter_project/services/capture_pipeline_service.dart';
import 'package:screensync_flutter_project/services/media_projection_service.dart';

/// The Kotlin capture service makes the final picture (crop, width limit, JPEG or
/// PNG), so a JPEG preset skips the Dart decode and re-encode. These pin the Dart
/// half of that contract: what the `captureScreen` call asks for, how its reply is
/// read, and that a finished picture is not processed a second time.
///
/// The encoding itself is Kotlin (`FrameEncoder.kt`) and is measured on a device.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('com.screensync.mcp/media_projection');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  /// Not a decodable image: if the pipeline touched it, the test would throw.
  final finishedJpeg = Uint8List.fromList(<int>[0xFF, 0xD8, 1, 2, 3, 0xFF, 0xD9]);

  Object? reply;
  Object? lastArguments;

  setUp(() {
    reply = null;
    lastArguments = null;
    messenger.setMockMethodCallHandler(channel, (call) async {
      switch (call.method) {
        case 'isPaused':
          return false;
        case 'isCaptureReady':
          return true;
        case 'captureScreen':
          lastArguments = call.arguments;
          return reply;
      }
      return null;
    });
  });

  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  group('what captureScreen asks for', () {
    test('inspection is a native-resolution PNG', () {
      expect(
        MediaProjectionService.captureArguments(CaptureQuality.inspection),
        {'format': 'png'},
      );
    });

    test('fast is a 720 px JPEG at quality 74', () {
      expect(
        MediaProjectionService.captureArguments(CaptureQuality.fast),
        {'format': 'jpeg', 'maxWidth': 720, 'jpegQuality': 74},
      );
    });

    test('stream is a 480 px JPEG at quality 60', () {
      expect(
        MediaProjectionService.captureArguments(CaptureQuality.stream),
        {'format': 'jpeg', 'maxWidth': 480, 'jpegQuality': 60},
      );
    });

    test('a crop travels as the fractions the crop editor produced', () {
      final args = MediaProjectionService.captureArguments(
        CaptureQuality.fast,
        crop: const NormRect(0.1, 0.2, 0.5, 0.25),
      );
      expect(args['crop'], {'x': 0.1, 'y': 0.2, 'w': 0.5, 'h': 0.25});
    });

    test('the call that reaches the channel carries the preset', () async {
      reply = {'bytes': finishedJpeg, 'format': 'jpeg'};
      await MediaProjectionService.captureScreen(quality: CaptureQuality.stream);
      expect(lastArguments,
          {'format': 'jpeg', 'maxWidth': 480, 'jpegQuality': 60});
    });
  });

  group('how the reply is read', () {
    test('a finished picture is marked processed, with its own mime type',
        () async {
      reply = {'bytes': finishedJpeg, 'format': 'jpeg', 'width': 720, 'height': 1600};
      final capture = await MediaProjectionService.captureScreen(
          quality: CaptureQuality.fast);
      expect(capture.processed, isTrue);
      expect(capture.mimeType, 'image/jpeg');
      expect(capture.bytes, finishedJpeg);
    });

    test('a bare byte reply is a raw PNG that still needs the pipeline',
        () async {
      reply = Uint8List.fromList(<int>[1, 2, 3]);
      final capture = await MediaProjectionService.captureScreen();
      expect(capture.processed, isFalse);
      expect(capture.mimeType, 'image/png');
    });

    test('an empty reply is an error, not a blank frame', () async {
      reply = {'bytes': Uint8List(0), 'format': 'jpeg'};
      await expectLater(
        MediaProjectionService.captureScreen(quality: CaptureQuality.fast),
        throwsA(isA<PlatformException>()
            .having((e) => e.code, 'code', 'empty_capture')),
      );
      reply = null;
      await expectLater(
        MediaProjectionService.captureScreen(),
        throwsA(isA<PlatformException>()),
      );
    });
  });

  group('the Dart pipeline is skipped for a finished picture', () {
    late ScreenRepository repo;
    setUp(() => repo = ScreenRepository());

    test('fast: the native JPEG is returned untouched', () async {
      reply = {'bytes': finishedJpeg, 'format': 'jpeg'};
      final frame =
          await repo.captureCurrentDisplay(quality: CaptureQuality.fast);
      // These bytes cannot be decoded, so returning them means nothing tried.
      expect(frame.imageBytes, finishedJpeg);
      expect(frame.mimeType, 'image/jpeg');
    });

    test('a crop is done by Kotlin and not repeated in Dart', () async {
      reply = {'bytes': finishedJpeg, 'format': 'jpeg'};
      final frame = await repo.captureCurrentDisplay(
        quality: CaptureQuality.stream,
        crop: const NormRect(0, 0, 0.5, 0.5),
      );
      expect(frame.imageBytes, finishedJpeg);
      expect((lastArguments as Map)['crop'], isNotNull);
    });

    test('inspection: the native PNG is returned untouched', () async {
      final png = Uint8List.fromList(<int>[0x89, 0x50, 0x4E, 0x47, 9, 9]);
      reply = {'bytes': png, 'format': 'png'};
      final frame = await repo.captureCurrentDisplay();
      expect(frame.imageBytes, png);
      expect(frame.mimeType, 'image/png');
    });

    test('a raw PNG from a native side without the encoder still becomes a JPEG',
        () async {
      final image = img.Image(width: 120, height: 200);
      img.fill(image, color: img.ColorRgb8(30, 90, 200));
      reply = Uint8List.fromList(img.encodePng(image));

      final frame =
          await repo.captureCurrentDisplay(quality: CaptureQuality.fast);
      expect(frame.mimeType, 'image/jpeg');
      expect(img.decodeJpg(frame.imageBytes), isNotNull);
    });
  });
}
