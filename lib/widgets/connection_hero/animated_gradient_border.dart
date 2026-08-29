import 'dart:ui';

import 'package:flutter/material.dart';

import '../../core/app_theme.dart';

/// Reusable glassmorphism wrapper with a slowly-rotating sweep-gradient
/// border whose colours reflect connection state.
///
/// - green  → online / healthy
/// - amber  → connecting / slow link
/// - red    → offline
///
/// Wraps [child] in a [BackdropFilter] blur and paints an animated conic
/// (sweep) gradient border around it via a [CustomPainter]. The rotation
/// runs on a ~7s [AnimationController] that is disposed properly and paused
/// when reduced-motion is requested.
class AnimatedGradientBorder extends StatefulWidget {
  const AnimatedGradientBorder({
    super.key,
    required this.child,
    required this.state,
    this.borderRadius = AppTheme.radiusL,
    this.borderWidth = 1.6,
    this.blurSigma = 14,
  });

  final Widget child;
  final GradientBorderState state;
  final double borderRadius;
  final double borderWidth;
  final double blurSigma;

  @override
  State<AnimatedGradientBorder> createState() => _AnimatedGradientBorderState();
}

/// Connection buckets that drive the border colour set.
enum GradientBorderState { online, connecting, offline }

class _AnimatedGradientBorderState extends State<AnimatedGradientBorder>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 7),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  List<Color> _colorsFor(GradientBorderState s) {
    switch (s) {
      case GradientBorderState.online:
        return const [
          AppTheme.success,
          AppTheme.primary,
          AppTheme.secondary,
          AppTheme.success,
        ];
      case GradientBorderState.connecting:
        return const [
          AppTheme.warning,
          AppTheme.primary,
          AppTheme.secondary,
          AppTheme.warning,
        ];
      case GradientBorderState.offline:
        return const [
          AppTheme.danger,
          Color(0xFF7A1F1F),
          AppTheme.danger,
          Color(0xFF7A1F1F),
        ];
    }
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    final radius = BorderRadius.circular(widget.borderRadius);
    final colors = _colorsFor(widget.state);

    final content = ClipRRect(
      borderRadius: radius,
      child: BackdropFilter(
        filter: ImageFilter.blur(
          sigmaX: widget.blurSigma,
          sigmaY: widget.blurSigma,
        ),
        child: widget.child,
      ),
    );

    Widget painterFor(double turns) => CustomPaint(
          painter: _SweepBorderPainter(
            turns: turns,
            colors: colors,
            radius: widget.borderRadius,
            strokeWidth: widget.borderWidth,
          ),
          child: content,
        );

    if (reduceMotion) {
      return painterFor(0);
    }

    return AnimatedBuilder(
      animation: _controller,
      builder: (_, child) => painterFor(_controller.value),
    );
  }
}

class _SweepBorderPainter extends CustomPainter {
  _SweepBorderPainter({
    required this.turns,
    required this.colors,
    required this.radius,
    required this.strokeWidth,
  });

  final double turns; // 0..1
  final List<Color> colors;
  final double radius;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final rrect = RRect.fromRectAndRadius(
      rect.deflate(strokeWidth / 2),
      Radius.circular(radius),
    );
    final center = rect.center;
    final gradient = SweepGradient(
      colors: colors,
      transform: GradientRotation(turns * 6.283185307179586),
    );
    final paint = Paint()
      ..shader = gradient.createShader(rect)
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth;
    // Subtle outer glow.
    final glow = Paint()
      ..shader = gradient.createShader(rect)
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth + 2
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6)
      ..color = colors.first.withValues(alpha: 0.4);
    canvas.drawRRect(rrect, glow);
    canvas.drawRRect(rrect, paint);
    // Keep center referenced to avoid unused warning in some SDKs.
    assert(center.dx >= 0);
  }

  @override
  bool shouldRepaint(covariant _SweepBorderPainter old) =>
      old.turns != turns ||
      old.colors != colors ||
      old.radius != radius ||
      old.strokeWidth != strokeWidth;
}
