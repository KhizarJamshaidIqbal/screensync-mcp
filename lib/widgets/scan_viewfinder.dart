import 'package:flutter/material.dart';

import '../core/app_theme.dart';
import '../core/motion.dart';

/// Animated QR viewfinder: corner brackets that breathe, plus a scan line that sweeps the
/// frame. Motion-safe - when the OS asks for reduced motion it draws the brackets at a
/// fixed opacity and no line at all, so the frame stays complete, just still.
class ScanViewfinder extends StatefulWidget {
  const ScanViewfinder({
    super.key,
    required this.size,
    this.reading = true,
    this.found = false,
  });

  final double size;

  /// False once a code has been read: the sweep stops and the frame dims.
  final bool reading;

  /// True for the success beat, which tints the brackets green and holds them solid.
  final bool found;

  @override
  State<ScanViewfinder> createState() => _ScanViewfinderState();
}

class _ScanViewfinderState extends State<ScanViewfinder>
    with SingleTickerProviderStateMixin {
  late final AnimationController _sweep = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2200),
  );

  @override
  void initState() {
    super.initState();
    _sweep.repeat(reverse: true);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Re-checked here because MediaQuery only resolves once dependencies are available.
    _sync();
  }

  @override
  void didUpdateWidget(ScanViewfinder oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.reading != widget.reading) _sync();
  }

  void _sync() {
    if (widget.reading && !reduceMotion(context)) {
      if (!_sweep.isAnimating) _sweep.repeat(reverse: true);
    } else {
      _sweep.stop();
    }
  }

  @override
  void dispose() {
    _sweep.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final still = reduceMotion(context);
    final reading = widget.reading && !still;
    return Semantics(
      label: 'QR scanner viewfinder',
      hint: 'Point the camera at the pairing code shown by the desktop hub',
      child: SizedBox(
        width: widget.size,
        height: widget.size,
        child: AnimatedBuilder(
          animation: _sweep,
          builder: (context, _) => CustomPaint(
            painter: _ViewfinderPainter(
              color: widget.found ? AppTheme.success : AppTheme.primary,
              alpha: widget.found
                  ? 1
                  : (widget.reading
                      ? 0.62 + 0.38 * AppTheme.motionEmphasis.transform(_sweep.value)
                      : 0.45),
              sweep: reading ? _sweep.value : -1,
            ),
          ),
        ),
      ),
    );
  }
}

class _ViewfinderPainter extends CustomPainter {
  const _ViewfinderPainter({
    required this.color,
    required this.alpha,
    required this.sweep,
  });

  final Color color;
  final double alpha;

  /// 0..1 while a scan line should be drawn, -1 for none.
  final double sweep;

  @override
  void paint(Canvas canvas, Size size) {
    const inset = 3.0;
    const radius = 18.0;
    final arm = size.shortestSide * 0.18;
    final rect = Rect.fromLTWH(
      inset,
      inset,
      size.width - inset * 2,
      size.height - inset * 2,
    );

    final bracket = Path()
      ..moveTo(rect.left, rect.top + arm)
      ..lineTo(rect.left, rect.top + radius)
      ..arcToPoint(Offset(rect.left + radius, rect.top),
          radius: const Radius.circular(radius))
      ..lineTo(rect.left + arm, rect.top)
      ..moveTo(rect.right - arm, rect.top)
      ..lineTo(rect.right - radius, rect.top)
      ..arcToPoint(Offset(rect.right, rect.top + radius),
          radius: const Radius.circular(radius))
      ..lineTo(rect.right, rect.top + arm)
      ..moveTo(rect.right, rect.bottom - arm)
      ..lineTo(rect.right, rect.bottom - radius)
      ..arcToPoint(Offset(rect.right - radius, rect.bottom),
          radius: const Radius.circular(radius))
      ..lineTo(rect.right - arm, rect.bottom)
      ..moveTo(rect.left + arm, rect.bottom)
      ..lineTo(rect.left + radius, rect.bottom)
      ..arcToPoint(Offset(rect.left, rect.bottom - radius),
          radius: const Radius.circular(radius))
      ..lineTo(rect.left, rect.bottom - arm);

    // Soft glow beneath the crisp stroke.
    canvas.drawPath(
      bracket,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 7
        ..strokeCap = StrokeCap.round
        ..color = color.withValues(alpha: alpha * 0.3)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8),
    );
    canvas.drawPath(
      bracket,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3.5
        ..strokeCap = StrokeCap.round
        ..color = color.withValues(alpha: alpha),
    );

    if (sweep < 0) return;

    final bandHeight = size.height * 0.16;
    final top = rect.top + (size.height - bandHeight) * sweep;
    final band = Rect.fromLTWH(rect.left + 6, top, rect.width - 12, bandHeight);
    canvas.drawRect(
      band,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: <Color>[
            color.withValues(alpha: 0),
            color.withValues(alpha: 0.4),
            color.withValues(alpha: 0),
          ],
        ).createShader(band),
    );
  }

  @override
  bool shouldRepaint(_ViewfinderPainter oldDelegate) =>
      oldDelegate.alpha != alpha ||
      oldDelegate.sweep != sweep ||
      oldDelegate.color != color;
}