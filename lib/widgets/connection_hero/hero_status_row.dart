import 'package:flutter/material.dart';

import '../../core/app_theme.dart';
import '../../services/connection_metrics_service.dart';
import 'live_sse_indicator.dart';

/// Colour of a link-health bucket, shared by the hero's badge, banner and the
/// diagnostics sheet so they can never disagree.
Color linkHealthColor(LinkHealth health) => switch (health) {
      LinkHealth.excellent => AppTheme.success,
      LinkHealth.good => AppTheme.primary,
      LinkHealth.slow => AppTheme.warning,
      LinkHealth.poor => AppTheme.danger,
      LinkHealth.offline => AppTheme.danger,
      LinkHealth.authProblem => AppTheme.danger,
    };

/// First row of the connection hero: status pill on the left, SSE indicator and
/// link-health badge on the right.
///
/// It is a [Wrap], not a Row of Flexible/Spacer children: those split the
/// leftover width equally, which on a 393 dp phone squeezed the pill to about
/// 30 dp (a dot with no label). Nothing here shrinks now; when the three do not
/// fit on one line the right-hand group drops below the pill instead.
class HeroStatusRow extends StatelessWidget {
  const HeroStatusRow({
    super.key,
    required this.online,
    required this.checking,
    required this.latencyMs,
    required this.liveConnected,
    required this.health,
    this.authFailed = false,
  });

  final bool online;
  final bool checking;
  final int? latencyMs;
  final bool liveConnected;
  final LinkHealth health;

  /// The hub is reachable but refuses this phone's token.
  final bool authFailed;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      alignment: WrapAlignment.spaceBetween,
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 6,
      runSpacing: 6,
      children: [
        HeroStatusPill(
          online: online,
          checking: checking,
          latencyMs: latencyMs,
          authFailed: authFailed,
        ),
        // A Wrap too, so even the right-hand pair gives way on a narrow screen
        // or a large system font instead of overflowing.
        Wrap(
          spacing: 6,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            LiveSseIndicator(connected: liveConnected),
            HeroHealthBadge(health: health),
          ],
        ),
      ],
    );
  }
}

class HeroStatusPill extends StatelessWidget {
  const HeroStatusPill({
    super.key,
    required this.online,
    required this.checking,
    required this.latencyMs,
    this.authFailed = false,
  });
  final bool online;
  final bool checking;
  final int? latencyMs;
  final bool authFailed;

  @override
  Widget build(BuildContext context) {
    final rejected = online && authFailed;
    final color = rejected
        ? AppTheme.danger
        : online
            ? AppTheme.success
            : (checking ? AppTheme.primary : AppTheme.danger);
    final word = rejected
        ? 'AUTH PROBLEM'
        : online
            ? 'CONNECTED'
            : (checking ? 'CONNECTING' : 'OFFLINE');
    final label = '$word · ${latencyMs ?? '—'}ms';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(shape: BoxShape.circle, color: color),
          ),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTheme.microLabel.copyWith(color: color),
            ),
          ),
        ],
      ),
    );
  }
}

/// The single link-quality chip. (A second, identical "grade" chip used to sit
/// beside it, so "Excellent" showed twice.)
class HeroHealthBadge extends StatelessWidget {
  const HeroHealthBadge({super.key, required this.health});
  final LinkHealth health;

  @override
  Widget build(BuildContext context) {
    final color = linkHealthColor(health);
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 220),
      transitionBuilder: (child, anim) => FadeTransition(
        opacity: anim,
        child: ScaleTransition(scale: anim, child: child),
      ),
      child: Container(
        key: ValueKey(health),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: color.withValues(alpha: 0.35)),
        ),
        child: Text(
          health.label,
          style: AppTheme.microLabel.copyWith(color: color, fontSize: 9),
        ),
      ),
    );
  }
}
