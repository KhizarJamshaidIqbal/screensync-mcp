import 'package:flutter/material.dart';

import '../../core/app_theme.dart';

/// Small "● SSE LIVE" pill — visually distinct from the HTTP-hub status
/// so the user can tell at a glance whether real-time agent pushback is
/// flowing or just one-shot HTTP.
class LiveSseIndicator extends StatelessWidget {
  const LiveSseIndicator({super.key, required this.connected});
  final bool connected;

  @override
  Widget build(BuildContext context) {
    final color = connected ? AppTheme.success : AppTheme.darkTextDim;
    final label = connected ? 'SSE Live' : 'SSE Off';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _PulsingDot(active: connected, color: color),
          const SizedBox(width: 5),
          Text(
            label,
            style: AppTheme.microLabel.copyWith(color: color, fontSize: 9),
          ),
        ],
      ),
    );
  }
}

class _PulsingDot extends StatefulWidget {
  const _PulsingDot({required this.active, required this.color});
  final bool active;
  final Color color;

  @override
  State<_PulsingDot> createState() => _PulsingDotState();
}

class _PulsingDotState extends State<_PulsingDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  );

  @override
  void initState() {
    super.initState();
    if (widget.active) _c.repeat(reverse: true);
  }

  @override
  void didUpdateWidget(covariant _PulsingDot oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active && !_c.isAnimating) _c.repeat(reverse: true);
    if (!widget.active && _c.isAnimating) _c.stop();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.active) {
      return Container(
        width: 6,
        height: 6,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: widget.color.withValues(alpha: 0.5),
        ),
      );
    }
    return AnimatedBuilder(
      animation: _c,
      builder: (_, __) => Container(
        width: 6,
        height: 6,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: widget.color,
          boxShadow: [
            BoxShadow(
              color: widget.color.withValues(alpha: 0.5 * (1 - _c.value)),
              blurRadius: 4 + 4 * _c.value,
              spreadRadius: 1,
            ),
          ],
        ),
      ),
    );
  }
}
