import 'package:flutter/material.dart';

import '../core/app_theme.dart';

/// Uppercase tracked micro-label (STORED, THIS PHONE, CONFIGURATION…).
class MicroLabel extends StatelessWidget {
  const MicroLabel(this.text, {super.key, this.color});
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

/// "● CONNECTED · 101MS" status pill under the app bar, with pulsing dot.
class StatusDotPill extends StatefulWidget {
  const StatusDotPill({
    super.key,
    required this.label,
    required this.color,
  });
  final String label;
  final Color color;

  @override
  State<StatusDotPill> createState() => _StatusDotPillState();
}

class _StatusDotPillState extends State<StatusDotPill>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: widget.color.withValues(alpha: dark ? 0.16 : 0.10),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: widget.color.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          AnimatedBuilder(
            animation: _pulse,
            builder: (_, __) => Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: widget.color,
                boxShadow: [
                  BoxShadow(
                    color: widget.color
                        .withValues(alpha: 0.5 * (1 - _pulse.value)),
                    blurRadius: 4 + 4 * _pulse.value,
                    spreadRadius: 1,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 6),
          Text(
            widget.label.toUpperCase(),
            style: AppTheme.microLabel.copyWith(color: widget.color),
          ),
        ],
      ),
    );
  }
}

/// Serif display heading with the italic magenta accent word.
class WatchHeading extends StatelessWidget {
  const WatchHeading({super.key});

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).brightness == Brightness.dark
        ? const Color(0xFFF2EEFB)
        : const Color(0xFF221A38);
    final base = AppTheme.typeDisplay.copyWith(color: text);
    return Text.rich(
      TextSpan(
        style: base,
        children: [
          const TextSpan(text: 'Your AI,\n'),
          TextSpan(
            text: 'watching',
            style: base.copyWith(
              fontStyle: FontStyle.italic,
              color: AppTheme.accentMagenta,
            ),
          ),
          const TextSpan(text: ' over\nyour shoulder.'),
        ],
      ),
    );
  }
}

/// Glossy rounded-square gradient icon tile (3D-ish highlight).
class GlossyTile extends StatelessWidget {
  const GlossyTile({
    super.key,
    required this.icon,
    this.gradient = AppTheme.gradPrimary,
    this.size = 44,
    this.iconSize = 20,
  });
  final IconData icon;
  final LinearGradient gradient;
  final double size;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: gradient,
        borderRadius: BorderRadius.circular(size * 0.32),
        boxShadow: [
          BoxShadow(
            color: gradient.colors.last.withValues(alpha: 0.45),
            blurRadius: 12,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Stack(
        children: [
          // Gloss highlight.
          Positioned(
            left: size * 0.14,
            top: size * 0.1,
            child: Container(
              width: size * 0.5,
              height: size * 0.28,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(999),
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.white.withValues(alpha: 0.55),
                    Colors.white.withValues(alpha: 0),
                  ],
                ),
              ),
            ),
          ),
          Center(
            child: Icon(icon, color: Colors.white, size: iconSize),
          ),
        ],
      ),
    );
  }
}

/// Phone ⟶ glowing orb illustration with latency pill, labels and an
/// animated data-flow line.
class PhoneLinkIllustration extends StatefulWidget {
  const PhoneLinkIllustration({
    super.key,
    required this.online,
    this.latencyMs,
  });
  final bool online;
  final int? latencyMs;

  @override
  State<PhoneLinkIllustration> createState() => _PhoneLinkIllustrationState();
}

class _PhoneLinkIllustrationState extends State<PhoneLinkIllustration>
    with SingleTickerProviderStateMixin {
  late final AnimationController _flow = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2200),
  )..repeat();

  @override
  void dispose() {
    _flow.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final online = widget.online;
    final accent = online ? AppTheme.primary : AppTheme.danger;
    return Row(
      children: [
        Column(
          children: [
            _PhoneMock(online: online),
            const SizedBox(height: 8),
            const MicroLabel('This phone'),
          ],
        ),
        Expanded(
          child: Column(
            children: [
              if (widget.latencyMs != null && online)
                Container(
                  margin: const EdgeInsets.only(bottom: 4),
                  padding: const EdgeInsets.symmetric(
                      horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: AppTheme.success.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(
                        color: AppTheme.success.withValues(alpha: 0.35)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.circle,
                          size: 5, color: AppTheme.success),
                      const SizedBox(width: 4),
                      Text(
                        '${widget.latencyMs} ms',
                        style: AppTheme.microLabel.copyWith(
                            color: AppTheme.success),
                      ),
                    ],
                  ),
                )
              else
                const SizedBox(height: 20),
              SizedBox(
                height: 14,
                child: AnimatedBuilder(
                  animation: _flow,
                  builder: (_, __) => CustomPaint(
                    painter: _LinkLinePainter(
                        color: accent,
                        active: online,
                        progress: _flow.value),
                    child: const SizedBox.expand(),
                  ),
                ),
              ),
            ],
          ),
        ),
        Column(
          children: [
            _Orb(active: online),
            const SizedBox(height: 8),
            const MicroLabel('Your AI'),
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
        border: Border.all(
            color: AppTheme.primary.withValues(alpha: 0.35), width: 1.5),
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
      child: Stack(
        children: [
          Positioned(
            left: 12,
            top: 8,
            child: Container(
              width: 18,
              height: 10,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(999),
                color: Colors.white.withValues(alpha: 0.5),
              ),
            ),
          ),
          const Center(
            child: Icon(Icons.auto_awesome_rounded,
                color: Colors.white, size: 20),
          ),
        ],
      ),
    );
  }
}

class _LinkLinePainter extends CustomPainter {
  _LinkLinePainter(
      {required this.color, required this.active, this.progress = 0});
  final Color color;
  final bool active;
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final y = size.height / 2;
    final paint = Paint()
      ..color = color.withValues(alpha: active ? 0.7 : 0.45)
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;
    const dash = 5.0, gap = 6.0;
    double x = 4;
    while (x < size.width - 4) {
      final end = (x + dash).clamp(0.0, size.width - 4);
      canvas.drawLine(Offset(x, y), Offset(end, y), paint);
      x = end + gap;
    }
    if (!active) {
      final cx = size.width / 2;
      final cross = Paint()
        ..color = color
        ..strokeWidth = 2.4
        ..strokeCap = StrokeCap.round;
      canvas.drawLine(
          Offset(cx - 4, y - 4), Offset(cx + 4, y + 4), cross);
      canvas.drawLine(
          Offset(cx + 4, y - 4), Offset(cx - 4, y + 4), cross);
      return;
    }
    // Traveling data particles with end-fade.
    for (var i = 0; i < 3; i++) {
      final t = (progress + i / 3) % 1.0;
      final fade = t < 0.15
          ? t / 0.15
          : t > 0.85
              ? (1 - t) / 0.15
              : 1.0;
      canvas.drawCircle(
        Offset(4 + t * (size.width - 8), y),
        3,
        Paint()
          ..color = color.withValues(alpha: 0.9 * fade)
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 2),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _LinkLinePainter old) =>
      old.color != color || old.active != active || old.progress != progress;
}

/// Section header: uppercase title + optional italic serif accent.
class SectionHead extends StatelessWidget {
  const SectionHead({super.key, required this.title, this.accent});
  final String title;
  final String? accent;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).brightness == Brightness.dark
        ? const Color(0xFFF2EEFB)
        : const Color(0xFF221A38);
    return Row(
      children: [
        MicroLabel(title, color: text.withValues(alpha: 0.75)),
        if (accent != null) ...[
          const SizedBox(width: 8),
          Text(
            accent!,
            style: const TextStyle(
              fontFamily: 'serif',
              fontStyle: FontStyle.italic,
              fontSize: 11,
              color: AppTheme.darkTextDim,
            ),
          ),
        ],
      ],
    );
  }
}

/// Shared gradient call-to-action button (premium look, no overflow).
class GradientActionButton extends StatelessWidget {
  const GradientActionButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.gradient = AppTheme.gradPrimary,
    this.enabled = true,
  });
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final LinearGradient gradient;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: enabled ? 1 : 0.45,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: gradient,
          borderRadius: BorderRadius.circular(AppTheme.radiusM),
          boxShadow: enabled
              ? [
                  BoxShadow(
                    color: gradient.colors.last.withValues(alpha: 0.4),
                    blurRadius: 12,
                    offset: const Offset(0, 5),
                  ),
                ]
              : null,
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(AppTheme.radiusM),
            onTap: enabled ? onTap : null,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 13),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(icon, size: 16, color: Colors.white),
                  const SizedBox(width: 7),
                  Flexible(
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Public micro status chip (uppercase tracked label in tinted pill).
class MicroChip extends StatelessWidget {
  const MicroChip({super.key, required this.label, required this.color, this.icon});
  final String label;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 9, color: color),
            const SizedBox(width: 4),
          ],
          Text(label, style: AppTheme.microLabel.copyWith(color: color)),
        ],
      ),
    );
  }
}
