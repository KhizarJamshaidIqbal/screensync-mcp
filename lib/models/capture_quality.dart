/// Adaptive capture presets.
///
/// - [inspection] — native-resolution PNG, best for Claude vision analysis.
/// - [fast]       — ≤720 px JPEG, sub-200 ms LAN push.
/// - [stream]     — ≤480 px JPEG, ultra-low latency for rapid back-and-forth.
enum CaptureQuality { inspection, fast, stream }

extension CaptureQualityX on CaptureQuality {
  String get label => switch (this) {
        CaptureQuality.inspection => 'Inspection · PNG',
        CaptureQuality.fast => 'Fast · JPEG 720p',
        CaptureQuality.stream => 'Stream · JPEG 480p',
      };

  /// Long-edge target. `null` keeps native resolution.
  int? get maxWidthPreset => switch (this) {
        CaptureQuality.inspection => null, // full-res PNG
        CaptureQuality.fast => 720,
        CaptureQuality.stream => 480,
      };

  String get mime => switch (this) {
        CaptureQuality.inspection => 'image/png',
        CaptureQuality.fast => 'image/jpeg',
        CaptureQuality.stream => 'image/jpeg',
      };

  /// JPEG quality percentage (ignored for PNG).
  int get jpegQuality => switch (this) {
        CaptureQuality.inspection => 100,
        CaptureQuality.fast => 74,
        CaptureQuality.stream => 60, // smaller payload, faster Claude response
      };
}
