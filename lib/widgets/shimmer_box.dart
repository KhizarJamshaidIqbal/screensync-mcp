import 'package:flutter/material.dart';

import '../core/app_theme.dart';
import '../core/motion.dart';

/// E4: dependency-free shimmer skeleton. Replaces blank/black first-frame
/// placeholders while thumbnails / catalogs load. Static (no sweep) when
/// the user disabled animations.
class ShimmerBox extends StatefulWidget {
  const ShimmerBox({
    super.key,
    this.width,
    this.height = 16,
    this.borderRadius = AppTheme.radiusS,
  });

  final double? width;
  final double height;
  final double borderRadius;

  @override
  State<ShimmerBox> createState() => _ShimmerBoxState();
}

class _ShimmerBoxState extends State<ShimmerBox>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1300),
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final base = dark ? AppTheme.darkSurfaceAlt : AppTheme.lightSurfaceAlt;
    final glow = dark ? const Color(0xFF3A2C5E) : const Color(0xFFE9E2F8);
    final still = reduceMotion(context);
    if (!still && !_controller.isAnimating) _controller.repeat();
    if (still && _controller.isAnimating) _controller.stop();

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final t = _controller.value;
        return Container(
          width: widget.width,
          height: widget.height,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(widget.borderRadius),
            gradient: still
                ? LinearGradient(colors: [base, base])
                : LinearGradient(
                    begin: Alignment(-1 + 2 * t, 0),
                    end: Alignment(0 + 2 * t, 0),
                    colors: [base, glow, base],
                  ),
          ),
        );
      },
    );
  }
}

/// Convenience column of shimmer lines for list-style skeletons.
class ShimmerLines extends StatelessWidget {
  const ShimmerLines({super.key, this.lines = 3});
  final int lines;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < lines; i++) ...[
          ShimmerBox(width: i.isEven ? double.infinity : 180),
          const SizedBox(height: 10),
        ],
      ],
    );
  }
}
