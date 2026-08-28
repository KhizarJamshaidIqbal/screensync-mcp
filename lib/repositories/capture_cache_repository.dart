import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

import '../models/frame_entry.dart';

/// Local-first capture history: every frame lands here before any sync,
/// giving instant gallery previews even fully offline.
class CaptureCacheRepository {
  static const _dbName = 'screensync_cache.db';
  static const _dbVersion = 1;
  static const maxRows = 60;

  Directory? _thumbsDir;
  Future<Database>? _db;

  Future<Directory> get thumbsDir async => _thumbsDir ??= await _ensureThumbs();

  /// Memoized: capture hot paths do several DB calls per frame.
  Future<Database> _open() => _db ??= _openOnce();

  Future<Database> _openOnce() async {
    final docs = await getApplicationDocumentsDirectory();
    return openDatabase('${docs.path}/$_dbName',
        version: _dbVersion, onCreate: (d, _) async => d.execute(_createSql));
  }

  static const _createSql = '''
    CREATE TABLE IF NOT EXISTS frames (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      filePath TEXT NOT NULL,
      thumbPath TEXT,
      width INTEGER DEFAULT 0,
      height INTEGER DEFAULT 0,
      byteLength INTEGER DEFAULT 0,
      capturedAt TEXT NOT NULL,
      syncedHub INTEGER DEFAULT 0,
      syncedDrive INTEGER DEFAULT 0
    )''';

  Future<Directory> _ensureThumbs() async {
    final docs = await getApplicationDocumentsDirectory();
    final dir = Directory('${docs.path}/screensync_thumbs');
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  /// 320px-wide PNG snapshot for grid previews.
  Future<Uint8List> buildThumbnail(Uint8List pngBytes) async {
    final codec = await ui.instantiateImageCodec(pngBytes, targetWidth: 320);
    final frame = await codec.getNextFrame();
    final data = await frame.image.toByteData(format: ui.ImageByteFormat.png);
    frame.image.dispose();
    if (data == null) throw StateError('thumbnail encode failed');
    return data.buffer.asUint8List();
  }

  Future<int> saveFrame({
    required String filename,
    required String filePath,
    required int width,
    required int height,
    required int byteLength,
    required String thumbPath,
  }) async {
    final inserted = await (await _open()).insert('frames', {
      'filename': filename,
      'filePath': filePath,
      'thumbPath': thumbPath,
      'width': width,
      'height': height,
      'byteLength': byteLength,
      'capturedAt': DateTime.now().toIso8601String(),
      'syncedHub': 0,
      'syncedDrive': 0,
    });
    unawaited(prune());
    return inserted;
  }

  Future<List<FrameEntry>> recentFrames({int limit = maxRows}) async {
    final rows =
        await (await _open()).query('frames', orderBy: 'id DESC', limit: limit);
    return rows.map(FrameEntry.fromRow).toList();
  }

  Future<void> markSyncedHub(int id) async {
    await (await _open())
        .update('frames', {'syncedHub': 1}, where: 'id = ?', whereArgs: [id]);
  }

  Future<void> markSyncedDrive(int id) async {
    await (await _open())
        .update('frames', {'syncedDrive': 1}, where: 'id = ?', whereArgs: [id]);
  }

  Future<void> markAllSyncedHub() async {
    await (await _open())
        .update('frames', {'syncedHub': 1}, where: 'syncedHub = 0');
  }

  Future<int> unsyncedHubCount() async {
    final r = await (await _open())
        .rawQuery('SELECT COUNT(*) c FROM frames WHERE syncedHub = 0');
    return Sqflite.firstIntValue(r) ?? 0;
  }

  /// Oldest-first rows still awaiting a hub push (auto-sync backlog).
  Future<List<FrameEntry>> unsyncedHubFrames({int limit = 20}) async {
    final rows = await (await _open()).query('frames',
        where: 'syncedHub = 0', orderBy: 'id ASC', limit: limit);
    return rows.map(FrameEntry.fromRow).toList();
  }

  /// Drops oldest rows past [maxRows] along with their binaries.
  Future<void> prune() async {
    final d = await _open();
    final stale = await d.rawQuery(
        'SELECT id, filePath, thumbPath FROM frames ORDER BY id DESC LIMIT -1 OFFSET ?',
        [maxRows]);
    for (final row in stale) {
      for (final key in ['filePath', 'thumbPath']) {
        final p = row[key] as String?;
        if (p == null || p.isEmpty || !File(p).existsSync()) continue;
        try {
          await File(p).delete();
        } catch (_) {}
      }
      await d.delete('frames', where: 'id = ?', whereArgs: [row['id']]);
    }
  }

  Future<void> deleteFrame(FrameEntry entry) async {
    for (final p in [entry.filePath, entry.thumbPath]) {
      try {
        if (p.isNotEmpty && File(p).existsSync()) await File(p).delete();
      } catch (_) {}
    }
    await (await _open())
        .delete('frames', where: 'id = ?', whereArgs: [entry.id]);
  }
}
