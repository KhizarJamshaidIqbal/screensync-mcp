import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:image/image.dart' as img;
import 'package:path_provider/path_provider.dart';

import '../repositories/capture_cache_repository.dart';
import '../services/capture_pipeline_service.dart';

enum _Tool { freehand, arrow, circle, blur }

class _Stroke {
  final _Tool tool;
  final Color color;
  final List<Offset> points;
  _Stroke({required this.tool, required this.color, required this.points});
}

/// Markup editor: draw arrows/circles/freehand or drag blur boxes to redact
/// sensitive regions before a frame goes to the AI or a share sheet.
class AnnotateScreen extends StatefulWidget {
  const AnnotateScreen({super.key, required this.imagePath});

  final String imagePath;

  @override
  State<AnnotateScreen> createState() => _AnnotateScreenState();
}

class _AnnotateScreenState extends State<AnnotateScreen> {
  static const _colors = [
    Color(0xFFEF4444),
    Color(0xFFF59E0B),
    Color(0xFF10B981),
    Color(0xFFA78BFA),
  ];

  _Tool _tool = _Tool.freehand;
  Color _color = _colors[0];
  final List<_Stroke> _strokes = [];
  _Stroke? _active;
  bool _saving = false;
  Size _displaySize = const Size(360, 640);

  void _onPanStart(DragStartDetails d) {
    setState(() => _active = _Stroke(tool: _tool, color: _color, points: [d.localPosition]));
  }

  void _onPanUpdate(DragUpdateDetails d) {
    setState(() => _active?.points.add(d.localPosition));
  }

  void _onPanEnd(DragEndDetails d) {
    setState(() {
      final active = _active;
      _active = null;
      if (active != null && active.points.length > 1) _strokes.add(active);
    });
  }

  Future<void> _save() async {
    if (_saving) return;
    setState(() => _saving = true);
    try {
      final bytes = await _export();
      final docs = await getApplicationDocumentsDirectory();
      final ts = DateTime.now().millisecondsSinceEpoch;
      final path =
          await CapturePipeline.persist(bytes, 'annotated_$ts.png', docs.path);
      final decoded = await _decodeSize(bytes);
      final thumb = await CapturePipeline.thumbnail(bytes);
      final repo = CaptureCacheRepository();
      final tdir = await repo.thumbsDir;
      final thumbFile = File('${tdir.path}/t_annotated_$ts.png');
      await thumbFile.writeAsBytes(thumb, flush: true);
      await repo.saveFrame(
        filename: 'annotated_$ts.png',
        filePath: path,
        width: decoded.width,
        height: decoded.height,
        byteLength: bytes.length,
        thumbPath: thumbFile.path,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Annotated frame saved to Gallery.')));
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Export failed: $e')));
    }
  }

  Future<ui.Image> _decodeImage(Uint8List bytes) async {
    final codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    return frame.image;
  }

  Future<ui.Image> _decodeSize(Uint8List bytes) => _decodeImage(bytes);

  /// Re-renders the base image + vector strokes at native resolution, then
  /// bakes blur boxes with package:image (region crop → blur → composite).
  Future<Uint8List> _export() async {
    final file = File(widget.imagePath);
    final sourceBytes = await file.readAsBytes();
    final source = await _decodeImage(sourceBytes);
    final scale = source.width / _displaySize.width;

    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    canvas.drawImage(source, Offset.zero, Paint());
    for (final stroke in [..._strokes]) {
      if (stroke.tool == _Tool.blur) continue; // baked below
      _paintStroke(canvas, stroke, scale);
    }
    final picture = recorder.endRecording();
    final out = await picture.toImage(source.width, source.height);
    final data = await out.toByteData(format: ui.ImageByteFormat.png);
    source.dispose();
    out.dispose();
    if (data == null) throw StateError('export encode failed');
    var bytes = data.buffer.asUint8List();

    final blurRects =
        _strokes.where((s) => s.tool == _Tool.blur).toList();
    if (blurRects.isNotEmpty) {
      final image = img.decodePng(bytes);
      if (image != null) {
        for (final stroke in blurRects) {
          final rect = _bounds(stroke.points);
          final x = (rect.left * scale).round().clamp(0, image.width - 1);
          final y = (rect.top * scale).round().clamp(0, image.height - 1);
          final w = (rect.width * scale)
              .round()
              .clamp(8, image.width - x);
          final h = (rect.height * scale)
              .round()
              .clamp(8, image.height - y);
          final region = img.copyCrop(image, x: x, y: y, width: w, height: h);
          final blurred = img.gaussianBlur(region, radius: 14);
          img.compositeImage(image, blurred, dstX: x, dstY: y);
        }
        bytes = Uint8List.fromList(img.encodePng(image));
      }
    }
    return bytes;
  }

  Rect _bounds(List<Offset> points) {
    var l = points.first.dx, t = points.first.dy;
    var r = l, b = t;
    for (final p in points) {
      l = math.min(l, p.dx);
      t = math.min(t, p.dy);
      r = math.max(r, p.dx);
      b = math.max(b, p.dy);
    }
    return Rect.fromLTRB(l, t, r, b);
  }

  void _paintStroke(Canvas canvas, _Stroke stroke, double scale) {
    final paint = Paint()
      ..color = stroke.color
      ..strokeWidth = 4 * scale
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final pts = stroke.points
        .map((p) => Offset(p.dx * scale, p.dy * scale))
        .toList();
    switch (stroke.tool) {
      case _Tool.freehand:
        final path = Path()..moveTo(pts.first.dx, pts.first.dy);
        for (final p in pts.skip(1)) { path.lineTo(p.dx, p.dy); }
        canvas.drawPath(path, paint);
      case _Tool.arrow:
        final from = pts.first;
        final to = pts.last;
        canvas.drawLine(from, to, paint);
        final angle = math.atan2(to.dy - from.dy, to.dx - from.dx);
        const head = 16.0;
        final p1 = Offset(to.dx - head * math.cos(angle - 0.5),
            to.dy - head * math.sin(angle - 0.5));
        final p2 = Offset(to.dx - head * math.cos(angle + 0.5),
            to.dy - head * math.sin(angle + 0.5));
        canvas.drawLine(to, p1, paint);
        canvas.drawLine(to, p2, paint);
      case _Tool.circle:
        canvas.drawOval(_boundsPts(pts), paint);
      case _Tool.blur:
        // Export bakes real blur; on-canvas preview shows a hatched box.
        canvas.drawRRect(
          RRect.fromRectAndRadius(_boundsPts(pts), const Radius.circular(8)),
          paint,
        );
    }
  }

  Rect _boundsPts(List<Offset> pts) => _bounds(pts);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Annotate'),
        actions: [
          IconButton(
            tooltip: 'Undo',
            icon: const Icon(Icons.undo_rounded),
            onPressed: _strokes.isEmpty
                ? null
                : () => setState(() => _strokes.removeLast()),
          ),
          FilledButton.icon(
            onPressed: _saving ? null : _save,
            icon: _saving
                ? const SizedBox.square(
                    dimension: 16,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.save_rounded, size: 18),
            label: const Text('Save'),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: LayoutBuilder(
                builder: (context, constraints) {
                  return FutureBuilder<ui.Image>(
                    future: _decodeImage(File(widget.imagePath).readAsBytesSync()),
                    builder: (context, snapshot) {
                      final image = snapshot.data;
                      if (image == null) {
                        return const Center(child: CircularProgressIndicator());
                      }
                      final aspect = image.width / image.height;
                      var w = constraints.maxWidth;
                      var h = w / aspect;
                      if (h > constraints.maxHeight) {
                        h = constraints.maxHeight;
                        w = h * aspect;
                      }
                      _displaySize = Size(w, h);
                      return Center(
                        child: GestureDetector(
                          behavior: HitTestBehavior.opaque,
                          onPanStart: _onPanStart,
                          onPanUpdate: _onPanUpdate,
                          onPanEnd: _onPanEnd,
                          child: SizedBox(
                            width: w,
                            height: h,
                            child: Stack(
                              children: [
                                Positioned.fill(
                                  child: Image.file(File(widget.imagePath),
                                      fit: BoxFit.fill),
                                ),
                                Positioned.fill(
                                  child: CustomPaint(
                                    painter: _StrokesPainter(
                                      strokes: [
                                        ..._strokes,
                                        if (_active != null) _active!,
                                      ],
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  );
                },
              ),
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Row(
                children: [
                  for (final tool in _Tool.values) ...[
                    _ToolButton(
                      icon: switch (tool) {
                        _Tool.freehand => Icons.draw_rounded,
                        _Tool.arrow => Icons.north_east_rounded,
                        _Tool.circle => Icons.circle_outlined,
                        _Tool.blur => Icons.blur_on_rounded,
                      },
                      selected: _tool == tool,
                      onTap: () => setState(() => _tool = tool),
                    ),
                    const SizedBox(width: 8),
                  ],
                  const Spacer(),
                  for (final color in _colors) ...[
                    GestureDetector(
                      onTap: () => setState(() => _color = color),
                      child: Container(
                        width: 26,
                        height: 26,
                        margin: const EdgeInsets.only(left: 6),
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: color,
                          border: Border.all(
                            color: _color == color
                                ? Colors.white
                                : Colors.transparent,
                            width: 2.5,
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ToolButton extends StatelessWidget {
  const _ToolButton({
    required this.icon,
    required this.selected,
    required this.onTap,
  });
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFFA78BFA) : const Color(0x1494A3B8),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(icon,
            size: 20, color: selected ? Colors.white : null),
      ),
    );
  }
}

class _StrokesPainter extends CustomPainter {
  _StrokesPainter({required this.strokes});
  final List<_Stroke?> strokes;

  @override
  void paint(Canvas canvas, Size size) {
    for (final stroke in strokes) {
      if (stroke == null || stroke.points.length < 2) continue;
      final paint = Paint()
        ..color = stroke.color
        ..strokeWidth = 4
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round;
      final pts = stroke.points;
      switch (stroke.tool) {
        case _Tool.freehand:
          final path = Path()..moveTo(pts.first.dx, pts.first.dy);
          for (final p in pts.skip(1)) { path.lineTo(p.dx, p.dy); }
          canvas.drawPath(path, paint);
        case _Tool.arrow:
          final from = pts.first;
          final to = pts.last;
          canvas.drawLine(from, to, paint);
          final angle = math.atan2(to.dy - from.dy, to.dx - from.dx);
          const head = 14.0;
          canvas.drawLine(
              to,
              Offset(to.dx - head * math.cos(angle - 0.5),
                  to.dy - head * math.sin(angle - 0.5)),
              paint);
          canvas.drawLine(
              to,
              Offset(to.dx - head * math.cos(angle + 0.5),
                  to.dy - head * math.sin(angle + 0.5)),
              paint);
        case _Tool.circle:
          canvas.drawOval(_bounds(pts), paint);
        case _Tool.blur:
          canvas.drawRRect(
            RRect.fromRectAndRadius(_bounds(pts), const Radius.circular(8)),
            paint..color = stroke.color.withValues(alpha: 0.5),
          );
      }
    }
  }

  Rect _bounds(List<Offset> points) {
    var l = points.first.dx, t = points.first.dy;
    var r = l, b = t;
    for (final p in points) {
      l = math.min(l, p.dx);
      t = math.min(t, p.dy);
      r = math.max(r, p.dx);
      b = math.max(b, p.dy);
    }
    return Rect.fromLTRB(l, t, r, b);
  }

  @override
  bool shouldRepaint(covariant _StrokesPainter old) => true;
}
