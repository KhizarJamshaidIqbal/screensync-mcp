import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/capture_pipeline_service.dart';

/// A fixed crop aspect ratio (width / height), or free-form when [ratio] null.
class _Aspect {
  final String label;
  final double? ratio;
  const _Aspect(this.label, this.ratio);
}

const _aspects = <_Aspect>[
  _Aspect('Free', null),
  _Aspect('1:1', 1.0),
  _Aspect('16:9', 16 / 9),
  _Aspect('9:16', 9 / 16),
  _Aspect('4:3', 4 / 3),
  _Aspect('3:4', 3 / 4),
];

/// Result of a region crop: the normalized rect (0..1) relative to the
/// source frame. Returned via Navigator.pop so the caller can crop + sync.
class RegionCropResult {
  final NormRect rect;
  const RegionCropResult(this.rect);
}

/// Which grab handle (if any) the active pointer is manipulating.
enum _Handle { none, move, tl, tr, bl, br, top, bottom, left, right, create }

/// Modern full-screen region selector that operates on an ALREADY-CAPTURED
/// frame (capture-first, crop-after).
///
/// Why this replaces the old overlay-window expand approach:
/// Android 12+ / MIUI / HyperOS clamp system overlay-window size, so
/// `FlutterOverlayWindow.resizeOverlay(fullScreen)` silently failed or
/// half-resized — cramming the selector into a 96dp bubble window and
/// throwing "BOTTOM OVERFLOWED BY 196 PIXELS". A normal Flutter route has
/// no such size cap and works identically on every OEM.
class RegionCropScreen extends StatefulWidget {
  const RegionCropScreen({super.key, required this.imageBytes});

  final Uint8List imageBytes;

  @override
  State<RegionCropScreen> createState() => _RegionCropScreenState();
}

class _RegionCropScreenState extends State<RegionCropScreen>
    with SingleTickerProviderStateMixin {
  ui.Image? _image;
  Size _imgSize = Size.zero;

  // Selection in *display* coordinates (relative to the fitted image rect).
  Rect? _sel;
  Rect _imageRect = Rect.zero; // where the image is drawn on screen (fitted)

  _Handle _active = _Handle.none;
  Offset _lastPointer = Offset.zero;
  Offset? _loupeAt; // pointer position for the magnifier loupe
  bool _saving = false;

  // Active aspect-ratio lock (index into [_aspects]); 0 = Free.
  int _aspectIndex = 0;
  double? get _lockedRatio => _aspects[_aspectIndex].ratio;

  // ── View transform (pinch-to-zoom + pan) ──
  // Applied on top of the fitted image rect. Selection math always runs in
  // this transformed space, so zooming lets you place edges pixel-precisely.
  double _zoom = 1.0;
  Offset _pan = Offset.zero;
  int _activePointers = 0; // >=2 → pinch/pan mode (selection suspended)
  double _zoomStart = 1.0;
  Offset _panStart = Offset.zero;
  Size _viewBox = Size.zero;

  static const double _handleHit = 30; // touch slop around handles
  static const double _minSel = 32; // min selection size in display px
  static const double _maxZoom = 5.0;

  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat(reverse: true);

  @override
  void initState() {
    super.initState();
    _decode();
  }

  @override
  void dispose() {
    _pulse.dispose();
    _image?.dispose();
    super.dispose();
  }

  Future<void> _decode() async {
    final codec = await ui.instantiateImageCodec(widget.imageBytes);
    final frame = await codec.getNextFrame();
    if (!mounted) return;
    setState(() {
      _image = frame.image;
      _imgSize =
          Size(frame.image.width.toDouble(), frame.image.height.toDouble());
    });
  }

  // ── Geometry helpers ──

  /// Base "fit" rect (zoom = 1, no pan).
  Rect _fitBase(Size box) {
    if (_imgSize.isEmpty) return Rect.zero;
    final scale = math.min(box.width / _imgSize.width, box.height / _imgSize.height);
    final w = _imgSize.width * scale;
    final h = _imgSize.height * scale;
    return Rect.fromLTWH((box.width - w) / 2, (box.height - h) / 2, w, h);
  }

  /// The image rect after applying zoom + pan around the view center.
  Rect _fitImage(Size box) {
    final base = _fitBase(box);
    if (base.isEmpty) return base;
    final center = box.center(Offset.zero);
    final scaled = Rect.fromCenter(
      center: center,
      width: base.width * _zoom,
      height: base.height * _zoom,
    );
    return scaled.shift(_pan);
  }

  /// Enforce the locked aspect ratio on a rect, anchoring at [anchor]
  /// (the corner/edge being dragged) so it grows the natural direction.
  Rect _applyRatio(Rect r, {required _Handle handle}) {
    final ratio = _lockedRatio;
    if (ratio == null) return r;
    var w = r.width;
    var h = r.height;
    // Drive the dimension the user is actively changing.
    final horizontal = handle == _Handle.left || handle == _Handle.right;
    final vertical = handle == _Handle.top || handle == _Handle.bottom;
    if (horizontal) {
      h = w / ratio;
    } else if (vertical) {
      w = h * ratio;
    } else {
      // corners / move / create: fit ratio inside the drawn box
      if (w / h > ratio) {
        w = h * ratio;
      } else {
        h = w / ratio;
      }
    }
    // Re-anchor depending on which handle moved.
    switch (handle) {
      case _Handle.tl:
        return Rect.fromLTRB(r.right - w, r.bottom - h, r.right, r.bottom);
      case _Handle.tr:
        return Rect.fromLTRB(r.left, r.bottom - h, r.left + w, r.bottom);
      case _Handle.bl:
        return Rect.fromLTRB(r.right - w, r.top, r.right, r.top + h);
      case _Handle.br:
      case _Handle.create:
        return Rect.fromLTWH(r.left, r.top, w, h);
      case _Handle.left:
        return Rect.fromLTRB(r.right - w, r.center.dy - h / 2, r.right, r.center.dy + h / 2);
      case _Handle.right:
        return Rect.fromLTRB(r.left, r.center.dy - h / 2, r.left + w, r.center.dy + h / 2);
      case _Handle.top:
        return Rect.fromLTRB(r.center.dx - w / 2, r.bottom - h, r.center.dx + w / 2, r.bottom);
      case _Handle.bottom:
        return Rect.fromLTRB(r.center.dx - w / 2, r.top, r.center.dx + w / 2, r.top + h);
      case _Handle.move:
      case _Handle.none:
        return Rect.fromCenter(center: r.center, width: w, height: h);
    }
  }

  _Handle _hitTest(Offset p) {
    final s = _sel;
    if (s == null) return _Handle.create;
    bool near(Offset a) => (a - p).distance <= _handleHit;
    if (near(s.topLeft)) return _Handle.tl;
    if (near(s.topRight)) return _Handle.tr;
    if (near(s.bottomLeft)) return _Handle.bl;
    if (near(s.bottomRight)) return _Handle.br;
    if (near(s.topCenter)) return _Handle.top;
    if (near(s.bottomCenter)) return _Handle.bottom;
    if (near(s.centerLeft)) return _Handle.left;
    if (near(s.centerRight)) return _Handle.right;
    if (s.inflate(_handleHit).contains(p) && s.contains(p)) return _Handle.move;
    return _Handle.create;
  }

  Rect _clampToImage(Rect r) {
    final b = _imageRect;
    // The visible image region within the current viewport (image may be
    // zoomed/panned partly off-screen; only clamp to the on-screen part).
    final vis = b.intersect(Offset.zero & _viewBox);
    final bounds = vis.isEmpty ? b : vis;

    final ratio = _lockedRatio;
    if (ratio != null) {
      // Ratio-locked: keep the rect's shape. Shrink both dims if it exceeds
      // bounds, then translate fully inside.
      var w = r.width.clamp(_minSel, bounds.width);
      var h = r.height.clamp(_minSel, bounds.height);
      if (w / h > ratio) {
        w = h * ratio;
      } else {
        h = w / ratio;
      }
      if (w > bounds.width) { w = bounds.width; h = w / ratio; }
      if (h > bounds.height) { h = bounds.height; w = h * ratio; }
      var left = r.left.clamp(bounds.left, bounds.right - w);
      var top = r.top.clamp(bounds.top, bounds.bottom - h);
      return Rect.fromLTWH(left, top, w, h);
    }

    var left = r.left.clamp(bounds.left, bounds.right);
    var top = r.top.clamp(bounds.top, bounds.bottom);
    var right = r.right.clamp(bounds.left, bounds.right);
    var bottom = r.bottom.clamp(bounds.top, bounds.bottom);
    if (right - left < _minSel) right = left + _minSel;
    if (bottom - top < _minSel) bottom = top + _minSel;
    if (right > bounds.right) { right = bounds.right; left = right - _minSel; }
    if (bottom > bounds.bottom) { bottom = bounds.bottom; top = bottom - _minSel; }
    return Rect.fromLTRB(left, top, right, bottom);
  }

  // ── Gesture handling ──

  void _onDown(Offset p) {
    HapticFeedback.selectionClick();
    _active = _hitTest(p);
    _lastPointer = p;
    if (_active == _Handle.create) {
      _sel = Rect.fromPoints(p, p);
    }
    setState(() => _loupeAt = p);
  }

  void _onMove(Offset p) {
    final d = p - _lastPointer;
    _lastPointer = p;
    final s = _sel;
    setState(() {
      _loupeAt = p;
      Rect? next;
      if (_active == _Handle.create && s != null) {
        next = _applyRatio(Rect.fromPoints(s.topLeft, p), handle: _Handle.create);
      } else if (s == null) {
        return;
      } else {
        switch (_active) {
          case _Handle.move:
            next = s.shift(d);
          case _Handle.tl:
            next = _applyRatio(Rect.fromLTRB(s.left + d.dx, s.top + d.dy, s.right, s.bottom), handle: _Handle.tl);
          case _Handle.tr:
            next = _applyRatio(Rect.fromLTRB(s.left, s.top + d.dy, s.right + d.dx, s.bottom), handle: _Handle.tr);
          case _Handle.bl:
            next = _applyRatio(Rect.fromLTRB(s.left + d.dx, s.top, s.right, s.bottom + d.dy), handle: _Handle.bl);
          case _Handle.br:
            next = _applyRatio(Rect.fromLTRB(s.left, s.top, s.right + d.dx, s.bottom + d.dy), handle: _Handle.br);
          case _Handle.top:
            next = _applyRatio(Rect.fromLTRB(s.left, s.top + d.dy, s.right, s.bottom), handle: _Handle.top);
          case _Handle.bottom:
            next = _applyRatio(Rect.fromLTRB(s.left, s.top, s.right, s.bottom + d.dy), handle: _Handle.bottom);
          case _Handle.left:
            next = _applyRatio(Rect.fromLTRB(s.left + d.dx, s.top, s.right, s.bottom), handle: _Handle.left);
          case _Handle.right:
            next = _applyRatio(Rect.fromLTRB(s.left, s.top, s.right + d.dx, s.bottom), handle: _Handle.right);
          case _Handle.none:
          case _Handle.create:
            break;
        }
      }
      if (next != null) _sel = _clampToImage(next);
    });
  }

  void _onUp() {
    _active = _Handle.none;
    setState(() => _loupeAt = null);
  }

  // ── Pinch zoom + pan (two-finger, tracked manually via Listener) ──
  //
  // We handle raw pointers ourselves instead of a ScaleGestureRecognizer so
  // there is zero gesture-arena conflict with single-finger selection:
  //   1 pointer  → draw / move / resize the selection
  //   2 pointers → pinch-zoom + pan the view (selection frozen)

  final Map<int, Offset> _pointers = {};
  double? _pinchStartDist;
  Offset? _pinchStartFocal;

  void _onPointerDown(int id, Offset p) {
    _pointers[id] = p;
    _activePointers = _pointers.length;
    if (_pointers.length >= 2) {
      _beginPinch();
      return;
    }
    _onDown(p);
  }

  void _onPointerMove(int id, Offset p) {
    _pointers[id] = p;
    if (_pointers.length >= 2) {
      _updatePinch();
      return;
    }
    if (_activePointers >= 2) return; // a finger lifted mid-pinch; wait
    _onMove(p);
  }

  void _onPointerUp(int id) {
    _pointers.remove(id);
    _activePointers = _pointers.length;
    if (_pointers.isEmpty) {
      _endPinch();
      _onUp();
    } else if (_pointers.length == 1) {
      // Dropped from pinch to one finger: end pinch, don't hijack as select.
      _endPinch();
      _lastPointer = _pointers.values.first;
      _active = _Handle.none;
    }
  }

  void _beginPinch() {
    final pts = _pointers.values.toList();
    _pinchStartDist = (pts[0] - pts[1]).distance;
    _pinchStartFocal = (pts[0] + pts[1]) / 2;
    _zoomStart = _zoom;
    _panStart = _pan;
    setState(() => _loupeAt = null);
  }

  void _updatePinch() {
    final pts = _pointers.values.toList();
    final dist = (pts[0] - pts[1]).distance;
    final focal = (pts[0] + pts[1]) / 2;
    final startDist = _pinchStartDist ?? dist;
    final startFocal = _pinchStartFocal ?? focal;
    setState(() {
      _zoom = (_zoomStart * (dist / (startDist == 0 ? 1 : startDist)))
          .clamp(1.0, _maxZoom);
      _pan = _panStart + (focal - startFocal);
      _constrainPan();
    });
  }

  void _endPinch() {
    _pinchStartDist = null;
    _pinchStartFocal = null;
    if (_zoom <= 1.01) {
      setState(() {
        _zoom = 1.0;
        _pan = Offset.zero;
      });
    } else {
      setState(_constrainPan);
    }
  }

  /// Stops the image from being panned entirely off-screen.
  void _constrainPan() {
    if (_viewBox.isEmpty) return;
    final base = _fitBase(_viewBox);
    final scaledW = base.width * _zoom;
    final scaledH = base.height * _zoom;
    final maxX = math.max(0.0, (scaledW - _viewBox.width) / 2);
    final maxY = math.max(0.0, (scaledH - _viewBox.height) / 2);
    _pan = Offset(
      _pan.dx.clamp(-maxX, maxX),
      _pan.dy.clamp(-maxY, maxY),
    );
  }

  void _resetZoom() {
    HapticFeedback.selectionClick();
    setState(() {
      _zoom = 1.0;
      _pan = Offset.zero;
    });
  }

  void _setAspect(int index) {
    HapticFeedback.selectionClick();
    setState(() {
      _aspectIndex = index;
      final s = _sel;
      final ratio = _aspects[index].ratio;
      if (s != null && ratio != null) {
        // Re-fit the existing selection to the new ratio, centered.
        _sel = _clampToImage(_applyRatio(s, handle: _Handle.none));
      }
    });
  }

  // ── Actions ──

  NormRect? _normalized() {
    final s = _sel;
    if (s == null || _imageRect.width == 0 || _imageRect.height == 0) return null;
    return NormRect(
      (s.left - _imageRect.left) / _imageRect.width,
      (s.top - _imageRect.top) / _imageRect.height,
      s.width / _imageRect.width,
      s.height / _imageRect.height,
    );
  }

  void _resetSelection() {
    HapticFeedback.mediumImpact();
    setState(() => _sel = null);
  }

  void _selectAll() {
    HapticFeedback.selectionClick();
    setState(() => _sel = _imageRect);
  }

  Future<void> _confirm() async {
    final norm = _normalized();
    if (norm == null || _saving) return;
    setState(() => _saving = true);
    HapticFeedback.heavyImpact();
    Navigator.of(context).pop(RegionCropResult(norm));
  }

  // Live pixel dimensions of the current selection (source-resolution).
  String _dimsLabel() {
    final s = _sel;
    if (s == null || _imageRect.width == 0) return 'Drag to select a region';
    final sx = _imgSize.width / _imageRect.width;
    final sy = _imgSize.height / _imageRect.height;
    final w = (s.width * sx).round();
    final h = (s.height * sy).round();
    return '$w × $h px';
  }

  @override
  Widget build(BuildContext context) {
    final image = _image;
    return Scaffold(
      backgroundColor: const Color(0xFF05070D),
      body: image == null
          ? const Center(child: CircularProgressIndicator())
          : SafeArea(
              child: Column(
                children: [
                  _topBar(),
                  Expanded(
                    child: LayoutBuilder(
                      builder: (context, constraints) {
                        final box = Size(constraints.maxWidth, constraints.maxHeight);
                        _viewBox = box;
                        _imageRect = _fitImage(box);
                        return Listener(
                          onPointerDown: (e) => _onPointerDown(e.pointer, e.localPosition),
                          onPointerMove: (e) => _onPointerMove(e.pointer, e.localPosition),
                          onPointerUp: (e) => _onPointerUp(e.pointer),
                          onPointerCancel: (e) => _onPointerUp(e.pointer),
                          child: Stack(
                            children: [
                              Positioned.fill(
                                child: CustomPaint(
                                  painter: _CropPainter(
                                    image: image,
                                    imageRect: _imageRect,
                                    selection: _sel,
                                    pulse: _pulse,
                                  ),
                                ),
                              ),
                              if (_zoom > 1.01)
                                Positioned(
                                  left: 12,
                                  bottom: 12,
                                  child: _ZoomBadge(zoom: _zoom, onReset: _resetZoom),
                                ),
                              if (_loupeAt != null &&
                                  _sel != null &&
                                  _activePointers < 2)
                                _Loupe(
                                  image: image,
                                  imageRect: _imageRect,
                                  focus: _loupeAt!,
                                ),
                            ],
                          ),
                        );
                      },
                    ),
                  ),
                  _bottomBar(),
                ],
              ),
            ),
    );
  }

  Widget _topBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Row(
        children: [
          _GhostButton(
            icon: Icons.close_rounded,
            onTap: () => Navigator.of(context).pop(),
          ),
          const Spacer(),
          AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
            decoration: BoxDecoration(
              color: const Color(0xCC0B1120),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: const Color(0xFF7C3AED), width: 1.2),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.crop_free_rounded, color: Color(0xFFA78BFA), size: 16),
                const SizedBox(width: 8),
                Text(
                  _dimsLabel(),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.2,
                  ),
                ),
              ],
            ),
          ),
          const Spacer(),
          _GhostButton(
            icon: Icons.select_all_rounded,
            onTap: _selectAll,
          ),
        ],
      ),
    );
  }

  Widget _bottomBar() {
    final hasSel = _sel != null;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0x0005070D), Color(0xF205070D)],
        ),
      ),
      child: Column(
        children: [
          // Aspect-ratio presets.
          SizedBox(
            height: 38,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _aspects.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, i) {
                final a = _aspects[i];
                final selected = i == _aspectIndex;
                return _AspectChip(
                  label: a.label,
                  icon: a.ratio == null ? Icons.crop_free_rounded : null,
                  selected: selected,
                  onTap: () => _setAspect(i),
                );
              },
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _ActionButton(
                  label: 'Reset',
                  icon: Icons.refresh_rounded,
                  filled: false,
                  onTap: hasSel ? _resetSelection : null,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                flex: 2,
                child: _ActionButton(
                  label: _saving ? 'Sending…' : 'Capture region',
                  icon: Icons.check_circle_rounded,
                  filled: true,
                  onTap: hasSel && !_saving ? _confirm : null,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            hasSel
                ? 'Drag the box or handles · pinch to zoom for precision'
                : 'Drag to draw a region · pinch to zoom · pick a ratio below',
            style: const TextStyle(color: Color(0xFF8A94A6), fontSize: 12),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

/// Paints the frozen screenshot, a dimmed mask outside the selection, the
/// selection border, rule-of-thirds grid, and 8 resize handles.
class _CropPainter extends CustomPainter {
  _CropPainter({
    required this.image,
    required this.imageRect,
    required this.selection,
    required this.pulse,
  }) : super(repaint: pulse);

  final ui.Image image;
  final Rect imageRect;
  final Rect? selection;
  final Animation<double> pulse;

  @override
  void paint(Canvas canvas, Size size) {
    // Base screenshot.
    paintImage(
      canvas: canvas,
      rect: imageRect,
      image: image,
      fit: BoxFit.fill,
      filterQuality: FilterQuality.medium,
    );

    final sel = selection;
    // Dim mask over everything, cutting out the selection.
    final mask = Paint()..color = const Color(0xAA05070D);
    if (sel == null) {
      canvas.drawRect(Offset.zero & size, mask);
      return;
    }
    final full = Path()..addRect(Offset.zero & size);
    final hole = Path()
      ..addRRect(RRect.fromRectAndRadius(sel, const Radius.circular(8)));
    canvas.drawPath(
      Path.combine(PathOperation.difference, full, hole),
      mask,
    );

    // Rule-of-thirds grid inside the selection.
    final grid = Paint()
      ..color = const Color(0x33FFFFFF)
      ..strokeWidth = 1;
    for (var i = 1; i < 3; i++) {
      final dx = sel.left + sel.width * i / 3;
      final dy = sel.top + sel.height * i / 3;
      canvas.drawLine(Offset(dx, sel.top), Offset(dx, sel.bottom), grid);
      canvas.drawLine(Offset(sel.left, dy), Offset(sel.right, dy), grid);
    }

    // Selection border (pulsing glow).
    final glow = 0.4 + 0.6 * pulse.value;
    final border = Paint()
      ..color = const Color(0xFFA78BFA)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5;
    final rr = RRect.fromRectAndRadius(sel, const Radius.circular(8));
    canvas.drawRRect(
      rr,
      Paint()
        ..color = const Color(0xFF8B5CF6).withValues(alpha: 0.5 * glow)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 6
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6),
    );
    canvas.drawRRect(rr, border);

    // 8 handles.
    final handleFill = Paint()..color = Colors.white;
    final handleRing = Paint()
      ..color = const Color(0xFF7C3AED)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5;
    for (final c in [
      sel.topLeft, sel.topRight, sel.bottomLeft, sel.bottomRight,
      sel.topCenter, sel.bottomCenter, sel.centerLeft, sel.centerRight,
    ]) {
      canvas.drawCircle(c, 7, handleFill);
      canvas.drawCircle(c, 7, handleRing);
    }
  }

  @override
  bool shouldRepaint(covariant _CropPainter old) =>
      old.selection != selection || old.imageRect != imageRect;
}

/// A magnifier loupe that shows a zoomed patch of the screenshot under the
/// finger for pixel-precise edge placement.
class _Loupe extends StatelessWidget {
  const _Loupe({
    required this.image,
    required this.imageRect,
    required this.focus,
  });

  final ui.Image image;
  final Rect imageRect;
  final Offset focus;

  @override
  Widget build(BuildContext context) {
    const size = 108.0;
    // Keep the loupe from covering the finger: park it opposite side.
    final top = focus.dy < 220;
    final dy = top ? focus.dy + 24 : focus.dy - size - 24;
    final dx = (focus.dx - size / 2)
        .clamp(8.0, MediaQuery.of(context).size.width - size - 8);
    return Positioned(
      left: dx,
      top: dy.clamp(8.0, MediaQuery.of(context).size.height - size - 8),
      child: IgnorePointer(
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: const Color(0xFFA78BFA), width: 2.5),
            boxShadow: const [
              BoxShadow(color: Color(0x88000000), blurRadius: 12, offset: Offset(0, 4)),
            ],
          ),
          child: ClipOval(
            child: CustomPaint(
              painter: _LoupePainter(
                image: image,
                imageRect: imageRect,
                focus: focus,
                zoom: 2.4,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _LoupePainter extends CustomPainter {
  _LoupePainter({
    required this.image,
    required this.imageRect,
    required this.focus,
    required this.zoom,
  });

  final ui.Image image;
  final Rect imageRect;
  final Offset focus;
  final double zoom;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = const Color(0xFF05070D));
    // Map focus (screen space) → image source pixel.
    final sx = image.width / imageRect.width;
    final sy = image.height / imageRect.height;
    final srcCenter = Offset(
      (focus.dx - imageRect.left) * sx,
      (focus.dy - imageRect.top) * sy,
    );
    final srcHalfW = size.width / (2 * zoom) * sx;
    final srcHalfH = size.height / (2 * zoom) * sy;
    final src = Rect.fromCenter(
      center: srcCenter,
      width: srcHalfW * 2,
      height: srcHalfH * 2,
    );
    canvas.drawImageRect(image, src, Offset.zero & size, Paint()
      ..filterQuality = FilterQuality.high);
    // Crosshair.
    final ch = Paint()
      ..color = const Color(0xFFA78BFA)
      ..strokeWidth = 1.2;
    canvas.drawLine(Offset(size.width / 2, 0), Offset(size.width / 2, size.height), ch);
    canvas.drawLine(Offset(0, size.height / 2), Offset(size.width, size.height / 2), ch);
  }

  @override
  bool shouldRepaint(covariant _LoupePainter old) => old.focus != focus;
}

class _AspectChip extends StatelessWidget {
  const _AspectChip({
    required this.label,
    required this.selected,
    required this.onTap,
    this.icon,
  });
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? const Color(0xFF7C3AED) : const Color(0x1494A3B8),
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: selected ? const Color(0xFFA78BFA) : Colors.transparent,
              width: 1.2,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 15, color: selected ? Colors.white : const Color(0xFFB6C0D0)),
                const SizedBox(width: 6),
              ],
              Text(
                label,
                style: TextStyle(
                  color: selected ? Colors.white : const Color(0xFFB6C0D0),
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ZoomBadge extends StatelessWidget {
  const _ZoomBadge({required this.zoom, required this.onReset});
  final double zoom;
  final VoidCallback onReset;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onReset,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(
            color: const Color(0xCC0B1120),
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: const Color(0xFF7C3AED), width: 1.1),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.zoom_in_rounded, color: Color(0xFFA78BFA), size: 15),
              const SizedBox(width: 6),
              Text(
                '${zoom.toStringAsFixed(1)}×  tap to reset',
                style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _GhostButton extends StatelessWidget {
  const _GhostButton({required this.icon, required this.onTap});
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkResponse(
      onTap: onTap,
      radius: 26,
      child: Container(
        width: 42,
        height: 42,
        decoration: BoxDecoration(
          color: const Color(0xCC0B1120),
          shape: BoxShape.circle,
          border: Border.all(color: const Color(0xFF1E293B)),
        ),
        child: Icon(icon, color: Colors.white, size: 20),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.label,
    required this.icon,
    required this.filled,
    required this.onTap,
  });
  final String label;
  final IconData icon;
  final bool filled;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return Opacity(
      opacity: enabled ? 1 : 0.45,
      child: Material(
        color: filled
            ? const Color(0xFF7C3AED)
            : const Color(0x1494A3B8),
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Container(
            height: 54,
            alignment: Alignment.center,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, color: Colors.white, size: 20),
                const SizedBox(width: 8),
                Text(
                  label,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
