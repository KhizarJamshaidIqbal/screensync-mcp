import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;

import 'package:screensync_flutter_project/models/capture_quality.dart';
import 'package:screensync_flutter_project/services/capture_pipeline_service.dart';

/// The live mirror runs `CapturePipeline.process` on every tick. Its codecs,
/// decoded frames and pictures are native allocations that used to be left to the
/// garbage collector (a leak per tick). They are now released explicitly, which
/// must not change what the pipeline produces. Native-memory release itself is
/// not observable from Dart, so these pin the outputs of every path that got a
/// `dispose()`.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Uint8List png;

  setUpAll(() {
    final image = img.Image(width: 120, height: 200);
    img.fill(image, color: img.ColorRgb8(200, 30, 90));
    png = Uint8List.fromList(img.encodePng(image));
  });

  test('stream preset downscales to a JPEG', () async {
    final out = await CapturePipeline.process(png, CaptureQuality.stream);

    final decoded = img.decodeJpg(out);
    expect(decoded, isNotNull, reason: 'JPEG output');
    expect(decoded!.width, lessThanOrEqualTo(480));
    expect(decoded.height, greaterThan(decoded.width));
  });

  test('repeated ticks keep working (no state left behind)', () async {
    for (var i = 0; i < 25; i++) {
      final out = await CapturePipeline.process(png, CaptureQuality.stream);
      expect(out, isNotEmpty);
    }
  });

  test('inspection keeps the original PNG bytes', () async {
    final out = await CapturePipeline.process(png, CaptureQuality.inspection);
    expect(out, png);
  });

  test('cropping returns the requested region as a PNG', () async {
    final out = await CapturePipeline.cropNormalized(
        png, const NormRect(0, 0, 0.5, 0.5));

    final decoded = img.decodePng(out);
    expect(decoded, isNotNull);
    expect(decoded!.width, 60);
    expect(decoded.height, 100);
  });

  test('crop then preset composes', () async {
    final out = await CapturePipeline.process(png, CaptureQuality.fast,
        crop: const NormRect(0.25, 0.25, 0.5, 0.5));
    expect(img.decodeJpg(out), isNotNull);
  });

  test('thumbnail is a 320 px wide PNG at most', () async {
    final big = img.Image(width: 640, height: 400);
    img.fill(big, color: img.ColorRgb8(10, 120, 200));
    final out = await CapturePipeline.thumbnail(
        Uint8List.fromList(img.encodePng(big)));

    final decoded = img.decodePng(out);
    expect(decoded, isNotNull);
    expect(decoded!.width, 320);
  });
}
