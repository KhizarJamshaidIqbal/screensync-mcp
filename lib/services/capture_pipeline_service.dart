import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/services.dart';
import 'package:image/image.dart' as img;

import '../models/capture_quality.dart';

/// Normalized rectangle (all values 0..1) relative to the captured frame.
class NormRect {
  final double nx, ny, nw, nh;
  const NormRect(this.nx, this.ny, this.nw, this.nh);
}

/// Pure-Dart frame post-processing:
/// adaptive downscale + format preset, and region cropping.
///
/// Quality presets:
///   inspection → native-resolution PNG (best for Claude).
///   fast       → ≤720 px JPEG @ 74 q  (sub-200 ms LAN push).
///   stream     → ≤480 px JPEG @ 60 q  (ultra-low latency streaming).
class CapturePipeline {
  CapturePipeline._();

  /// Applies [crop] (if any) then the [quality] preset.
  static Future<Uint8List> process(
    Uint8List rawPng,
    CaptureQuality quality, {
    NormRect? crop,
  }) async {
    var working = rawPng;
    if (crop != null) {
      working = await cropNormalized(rawPng, crop);
    }
    switch (quality) {
      case CaptureQuality.inspection:
        return working;
      case CaptureQuality.fast:
      case CaptureQuality.stream:
        return _encodeJpeg(
          working,
          targetWidth: quality.maxWidthPreset ?? 720,
          jpegQuality: quality.jpegQuality,
        );
    }
  }

  /// Crops [r] out of the decoded PNG, re-encoded as PNG.
  static Future<Uint8List> cropNormalized(
      Uint8List pngBytes, NormRect r) async {
    final source = await _decode(pngBytes);
    final sw = source.width.toDouble();
    final sh = source.height.toDouble();

    double clamp01(double v) => v.clamp(0.0, 1.0);
    final x = clamp01(r.nx) * sw;
    final y = clamp01(r.ny) * sh;
    final w = (clamp01(r.nx + r.nw) * sw - x).clamp(8.0, sw);
    final h = (clamp01(r.ny + r.nh) * sh - y).clamp(8.0, sh);

    final recorder = ui.PictureRecorder();
    final canvas = ui.Canvas(recorder);
    canvas.drawImageRect(
      source,
      ui.Rect.fromLTWH(x, y, w, h),
      ui.Rect.fromLTWH(0, 0, w, h),
      ui.Paint()..filterQuality = ui.FilterQuality.medium,
    );
    final picture = recorder.endRecording();
    final cropped = await picture.toImage(w.round(), h.round());
    final out = await cropped.toByteData(format: ui.ImageByteFormat.png);
    source.dispose();
    cropped.dispose();
    if (out == null) {
      throw PlatformException(code: 'crop-encode-failed');
    }
    return out.buffer.asUint8List();
  }

  static Future<ui.Image> _decode(Uint8List bytes) async {
    final codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    return frame.image;
  }

  /// Flutter can only emit PNG/raw from [ui.Image]; JPEG goes through
  /// package:image on the raw RGBA buffer for the low-latency presets.
  static Future<Uint8List> _encodeJpeg(
    Uint8List input, {
    required int targetWidth,
    required int jpegQuality,
  }) async {
    final codec =
        await ui.instantiateImageCodec(input, targetWidth: targetWidth);
    final frame = await codec.getNextFrame();
    final data = await frame.image
        .toByteData(format: ui.ImageByteFormat.rawStraightRgba);
    if (data == null) return input;
    final image = img.Image.fromBytes(
      width: frame.image.width,
      height: frame.image.height,
      bytes: data.buffer,
      numChannels: 4,
      order: img.ChannelOrder.rgba,
    );
    frame.image.dispose();
    return Uint8List.fromList(img.encodeJpg(image, quality: jpegQuality));
  }

  /// C2 privacy redaction: Dart-side pixelation blur applied BEFORE any
  /// upload leaves the device. Opt-in via Settings. Pixelation (mosaic) is
  /// preferred over gaussian for text privacy — it's irreversible at this
  /// block size and much cheaper on-device than a wide gaussian kernel.
  static Future<Uint8List> redact(
    Uint8List bytes, {
    bool jpeg = false,
    int jpegQuality = 74,
    int blockSize = 14,
  }) async {
    final decoded = img.decodeImage(bytes);
    if (decoded == null) return bytes;
    final redacted = img.pixelate(decoded,
        size: blockSize, mode: img.PixelateMode.average);
    final out = jpeg
        ? img.encodeJpg(redacted, quality: jpegQuality)
        : img.encodePng(redacted);
    return Uint8List.fromList(out);
  }

  /// 320px-wide PNG thumbnail for the local gallery grid.
  static Future<Uint8List> thumbnail(Uint8List imageBytes) async {
    final codec = await ui.instantiateImageCodec(imageBytes, targetWidth: 320);
    final frame = await codec.getNextFrame();
    final data = await frame.image.toByteData(format: ui.ImageByteFormat.png);
    frame.image.dispose();
    if (data == null) {
      throw PlatformException(code: 'thumb-encode-failed');
    }
    return data.buffer.asUint8List();
  }

  /// Persists bytes under the app-documents frames directory.
  static Future<String> persist(
      Uint8List bytes, String filename, String docsPath) async {
    final dir = Directory('$docsPath/screensync_frames');
    if (!await dir.exists()) await dir.create(recursive: true);
    final file = File('${dir.path}/$filename');
    await file.writeAsBytes(bytes, flush: true);
    return file.path;
  }
}
