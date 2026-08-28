import 'package:equatable/equatable.dart';

/// Row of the local SQLite capture history.
class FrameEntry extends Equatable {
  final int id;
  final String filename;
  final String filePath;
  final String thumbPath;
  final int width;
  final int height;
  final int byteLength;
  final DateTime capturedAt;
  final bool syncedHub;
  final bool syncedDrive;

  const FrameEntry({
    required this.id,
    required this.filename,
    required this.filePath,
    required this.thumbPath,
    required this.width,
    required this.height,
    required this.byteLength,
    required this.capturedAt,
    required this.syncedHub,
    required this.syncedDrive,
  });

  String get sizeLabel {
    if (byteLength < 1024) return '$byteLength B';
    if (byteLength < 1024 * 1024) {
      return '${(byteLength / 1024).toStringAsFixed(0)} KB';
    }
    return '${(byteLength / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  factory FrameEntry.fromRow(Map<String, Object?> row) {
    return FrameEntry(
      id: row['id']! as int,
      filename: row['filename']! as String,
      filePath: row['filePath']! as String,
      thumbPath: row['thumbPath'] as String? ?? '',
      width: row['width'] as int? ?? 0,
      height: row['height'] as int? ?? 0,
      byteLength: row['byteLength'] as int? ?? 0,
      capturedAt: DateTime.parse(row['capturedAt']! as String),
      syncedHub: (row['syncedHub'] as int? ?? 0) == 1,
      syncedDrive: (row['syncedDrive'] as int? ?? 0) == 1,
    );
  }

  @override
  List<Object?> get props => [
        id,
        filename,
        filePath,
        thumbPath,
        width,
        height,
        byteLength,
        capturedAt,
        syncedHub,
        syncedDrive,
      ];
}
