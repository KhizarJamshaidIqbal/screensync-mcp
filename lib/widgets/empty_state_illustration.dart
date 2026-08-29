import 'package:flutter/material.dart';

import '../core/app_theme.dart';

/// Illustrated, actionable empty state: a stylized bubble outline with a
/// dashed halo plus a message and CTA — replaces flat gray "no data" text.
class EmptyStateIllustration extends StatelessWidget {
  const EmptyStateIllustration({
    super.key,
    required this.message,
    this.ctaLabel,
    this.onCta,
  });

  final String message;
  final String? ctaLabel;
  final VoidCallback? onCta;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CustomPaint(
            size: const Size(120, 120),
            painter: _BubbleIllustrationPainter(),
          ),
          const SizedBox(height: 14),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(
                fontSize: 13, height: 1.5, color: AppTheme.darkTextDim),
          ),
          if (ctaLabel != null && onCta != null) ...[
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: onCta,
              icon: const Icon(Icons.play_arrow_rounded, size: 18),
              label: Text(ctaLabel!),
            ),
          ],
        ],
      ),
    );
  }
}

class _BubbleIllustrationPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);

    // Dashed halo ring.
    final halo = Paint()
      ..color = AppTheme.accentCyan.withValues(alpha: 0.55)
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;
    const dash = 6.0, gap = 7.0;
    final radius = size.width / 2 - 4;
    var angle = 0.0;
    while (angle < 6.283) {
      final end = (angle + dash / radius).clamp(0.0, 6.283);
      canvas.drawArc(
        Rect.fromCircle(center: center, radius: radius),
        angle,
        end - angle,
        false,
        halo,
      );
      angle = end + gap / radius;
    }

    // Bubble body.
    final body = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [Color(0xFF6D28D9), Color(0xFFA78BFA)],
      ).createShader(Rect.fromCircle(center: center, radius: 34));
    canvas.drawCircle(center, 34, body);
    canvas.drawCircle(
      center,
      34,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.5,
    );

    // Camera glyph (lens + body notch).
    final glyph = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.4
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final lensRect = RRect.fromRectAndRadius(
      Rect.fromLTWH(center.dx - 13, center.dy - 8, 26, 18),
      const Radius.circular(5),
    );
    canvas.drawRRect(lensRect, glyph);
    canvas.drawLine(
      Offset(center.dx - 6, center.dy - 8),
      Offset(center.dx - 3, center.dy - 13),
      glyph,
    );
    canvas.drawLine(
      Offset(center.dx + 3, center.dy - 13),
      Offset(center.dx + 6, center.dy - 8),
      glyph,
    );
    canvas.drawCircle(center, 5, glyph);

    // Sparkle accents.
    final sparkle = Paint()
      ..color = AppTheme.accentCyan
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;
    for (final (dx, dy, r) in const [(14.0, 22.0, 4.0), (104.0, 92.0, 3.0)]) {
      canvas.drawLine(Offset(dx, dy - r), Offset(dx, dy + r), sparkle);
      canvas.drawLine(Offset(dx - r, dy), Offset(dx + r, dy), sparkle);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
