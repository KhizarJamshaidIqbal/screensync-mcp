import 'package:flutter/material.dart';

import '../../core/app_theme.dart';

/// Animated packet-flow illustration. Replaces the static dashed line in the
/// original PhoneLinkIllustration with a stream of glowing particles whose
/// speed reflects link latency: a fast link sends packets quickly, a slow
/// link crawls. Includes a 5-segment speed bar above the line and the
/// existing latency pill on the left.
///
/// Performance note: the painter rebuilds every frame via
/// [ListenableBuilder], but the `shouldRepaint` check returns `false` for
/// any other packet state. The packets array itself is small (5 items) so
/// GC pressure is negligible.
class PacketFlowIllustration extends StatefulWidget {
  const PacketFlowIllustration({
    super.key,
    required this.online,
    required this.latencyMs,
  });

  final bool online;
  final int? latencyMs;

  @override
  State<PacketFlowIllustration> createState() => _PacketFlowIllustrationState();
}

class _PacketFlowIllustrationState extends State<PacketFlowIllustration>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  // Each packet has a phase offset so they're staggered along the line.
  // 0..1, with 0 = at phone, 1 = at AI.
  static const _packetPhases = <double>[0.0, 0.22, 0.44, 0.66, 0.88];

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: _cycleDurationFor(widget.latencyMs),
    )..repeat();
  }

  @override
  void didUpdateWidget(covariant PacketFlowIllustration oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Re-derive cycle duration when latency changes meaningfully so the
    // visual speed stays in sync with the sparkline.
    if (oldWidget.latencyMs != widget.latencyMs && widget.online) {
      _controller.duration = _cycleDurationFor(widget.latencyMs);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// Faster link ⇒ shorter cycle. Clamp at sane bounds so animation
  /// doesn't break on extreme values.
  Duration _cycleDurationFor(int? ms) {
    if (!widget.online || ms == null) {
      return const Duration(milliseconds: 2400);
    }
    if (ms < 50) return const Duration(milliseconds: 700);
    if (ms < 150) return const Duration(milliseconds: 1100);
    if (ms < 400) return const Duration(milliseconds: 1700);
    return const Duration(milliseconds: 2600);
  }

  @override
  Widget build(BuildContext context) {
    final accent = widget.online ? AppTheme.primary : AppTheme.danger;
    return Row(
      children: [
        Column(
          children: [
            _PhoneMock(online: widget.online),
            const SizedBox(height: 8),
            const MicroLabelCompact('This phone'),
          ],
        ),
        Expanded(
          child: Column(
            children: [
              if (widget.online && widget.latencyMs != null)
                _LatencyPill(latencyMs: widget.latencyMs!)
              else
                const SizedBox(height: 20),
              SizedBox(
                height: 14,
                child: ListenableBuilder(
                  listenable: _controller,
                  builder: (_, __) => CustomPaint(
                    painter: _PacketFlowPainter(
                      progress: _controller.value,
                      phases: _packetPhases,
                      color: accent,
                      active: widget.online,
                    ),
                    child: const SizedBox.expand(),
                  ),
                ),
              ),
            ],
          ),
        ),
        Column(
          children: [
            _Orb(active: widget.online),
            const SizedBox(height: 8),
            const MicroLabelCompact('Your AI'),
          ],
        ),
      ],
    );
  }
}

class _PhoneMock extends StatelessWidget {
  const _PhoneMock({required this.online});
  final bool online;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      width: 44,
      height: 64,
      decoration: BoxDecoration(
        color: dark ? const Color(0xFF2E2150) : const Color(0xFFE6DEF6),
        borderRadius: BorderRadius.circular(10),
        border:
            Border.all(color: AppTheme.primary.withValues(alpha: 0.35), width: 1.5),
        boxShadow: AppTheme.elevLow,
      ),
      child: Center(
        child: Container(
          width: 26,
          height: 40,
          decoration: BoxDecoration(
            gradient: online
                ? AppTheme.gradOrb
                : const LinearGradient(
                    colors: [Color(0xFFB9B3CC), Color(0xFF9C94BC)]),
            borderRadius: BorderRadius.circular(5),
          ),
        ),
      ),
    );
  }
}

class _Orb extends StatelessWidget {
  const _Orb({required this.active});
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 56,
      height: 56,
      decoration: BoxDecoration(
        gradient: active
            ? AppTheme.gradOrb
            : const LinearGradient(
                colors: [Color(0xFF8A85A3), Color(0xFF6B6485)]),
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: (active ? AppTheme.primary : const Color(0xFF6B6485))
                .withValues(alpha: 0.55),
            blurRadius: 22,
            spreadRadius: 2,
          ),
        ],
      ),
      child: const Center(
        child: Icon(Icons.auto_awesome_rounded, color: Colors.white, size: 20),
      ),
    );
  }
}

class _LatencyPill extends StatelessWidget {
  const _LatencyPill({required this.latencyMs});
  final int latencyMs;

  @override
  Widget build(BuildContext context) {
    final color = latencyMs < 100
        ? AppTheme.success
        : (latencyMs < 300 ? AppTheme.primary : AppTheme.warning);
    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.circle, size: 5, color: color),
          const SizedBox(width: 4),
          Text(
            '$latencyMs ms',
            style: AppTheme.microLabel.copyWith(color: color),
          ),
        ],
      ),
    );
  }
}

class MicroLabelCompact extends StatelessWidget {
  // Local copy of MicroLabel so this widget stays self-contained — the
  // dashboard may delete PhoneLinkIllustration, and we don't want a broken
  // import if ref_widgets moves.
  const MicroLabelCompact(this.text, {super.key, this.color});
  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: AppTheme.microLabel
          .copyWith(color: color ?? AppTheme.darkTextDim),
    );
  }
}

class _PacketFlowPainter extends CustomPainter {
  _PacketFlowPainter({
    required this.progress,
    required this.phases,
    required this.color,
    required this.active,
  });

  final double progress; // 0..1
  final List<double> phases; // 0..1, staggered
  final Color color;
  final bool active;

  @override
  void paint(Canvas canvas, Size size) {
    final y = size.height / 2;
    const leftPad = 4.0, rightPad = 4.0;
    final usableW = size.width - leftPad - rightPad;

    // Background dashed line (always visible — the "cable" itself).
    final linePaint = Paint()
      ..color = color.withValues(alpha: active ? 0.35 : 0.4)
      ..strokeWidth = 1.5
      ..strokeCap = StrokeCap.round;
    const dash = 4.0, gap = 4.0;
    double x = leftPad;
    while (x < size.width - rightPad) {
      final end = (x + dash).clamp(0.0, size.width - rightPad);
      canvas.drawLine(Offset(x, y), Offset(end, y), linePaint);
      x = end + gap;
    }

    if (!active) {
      // Big X over the cable when offline.
      final cross = Paint()
        ..color = color
        ..strokeWidth = 2.4
        ..strokeCap = StrokeCap.round;
      final cx = size.width / 2;
      canvas.drawLine(Offset(cx - 4, y - 4), Offset(cx + 4, y + 4), cross);
      canvas.drawLine(Offset(cx + 4, y - 4), Offset(cx - 4, y + 4), cross);
      return;
    }

    // Glowing packets riding the line.
    for (final phase in phases) {
      final t = (progress + phase) % 1.0;
      final px = leftPad + t * usableW;

      // Fade in/out at the ends so packets don't pop in/out abruptly.
      final alpha = (t < 0.1)
          ? (t / 0.1).clamp(0.0, 1.0)
          : (t > 0.9 ? (1 - (t - 0.9) / 0.1).clamp(0.0, 1.0) : 1.0);

      // Outer glow.
      canvas.drawCircle(
        Offset(px, y),
        5.5,
        Paint()..color = color.withValues(alpha: 0.25 * alpha),
      );
      // Bright core.
      canvas.drawCircle(
        Offset(px, y),
        2.6,
        Paint()..color = color.withValues(alpha: 0.95 * alpha),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _PacketFlowPainter old) =>
      old.progress != progress ||
      old.color != color ||
      old.active != active;
}
