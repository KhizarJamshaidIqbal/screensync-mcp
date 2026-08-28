import 'dart:typed_data';
import 'package:equatable/equatable.dart';

class CapturedFrame extends Equatable {
  final Uint8List imageBytes;
  final String filename;
  final DateTime timestamp;
  final String mimeType;

  CapturedFrame({
    required this.imageBytes,
    String? filename,
    DateTime? timestamp,
    this.mimeType = 'image/png',
  })  : filename = filename ??
            'screen_${DateTime.now().millisecondsSinceEpoch}${_extFor(mimeType)}',
        timestamp = timestamp ?? DateTime.now();

  static String _extFor(String mime) => mime == 'image/jpeg' ? '.jpg' : '.png';

  int get width => mimeType == 'image/jpeg' ? _readJpegDimension(isWidth: true) : _readPngDimension(16);
  int get height => mimeType == 'image/jpeg' ? _readJpegDimension(isWidth: false) : _readPngDimension(20);
  String get resolution => (width > 0 && height > 0) ? '$width × $height' : 'Adaptive';

  String get sizeLabel {
    final b = imageBytes.lengthInBytes;
    if (b < 1024) return '$b B';
    if (b < 1024 * 1024) return '${(b / 1024).toStringAsFixed(0)} KB';
    return '${(b / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  int _readPngDimension(int offset) {
    if (mimeType != 'image/png') return 0;
    if (imageBytes.lengthInBytes < offset + 4) return 0;
    return (imageBytes[offset] << 24) |
        (imageBytes[offset + 1] << 16) |
        (imageBytes[offset + 2] << 8) |
        imageBytes[offset + 3];
  }

  int _readJpegDimension({required bool isWidth}) {
    if (imageBytes.lengthInBytes < 4) return 0;
    if (imageBytes[0] != 0xFF || imageBytes[1] != 0xD8) return 0;
    int offset = 2;
    while (offset < imageBytes.lengthInBytes - 8) {
      if (imageBytes[offset] != 0xFF) break;
      final marker = imageBytes[offset + 1];
      if (marker == 0xD9 || marker == 0xDA) break; // EOI or SOS
      final segLen = (imageBytes[offset + 2] << 8) | imageBytes[offset + 3];
      // SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2)
      if (marker == 0xC0 || marker == 0xC1 || marker == 0xC2) {
        if (offset + 9 <= imageBytes.lengthInBytes) {
          final h = (imageBytes[offset + 5] << 8) | imageBytes[offset + 6];
          final w = (imageBytes[offset + 7] << 8) | imageBytes[offset + 8];
          return isWidth ? w : h;
        }
      }
      offset += 2 + segLen;
    }
    return 0;
  }

  @override
  List<Object?> get props => [filename, timestamp, mimeType];
}
