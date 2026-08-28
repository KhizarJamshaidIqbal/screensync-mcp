import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../services/connection_metrics_service.dart';
import 'ai_activity_feed.dart';
import 'hub_identity_row.dart';
import 'latency_sparkline.dart';
import 'live_sse_indicator.dart';
import 'packet_flow_illustration.dart';
import 'quick_actions_row.dart';
import 'session_stats_grid.dart';

/// ConnectionHero 2.0 — "Live Bridge".
///
/// Replaces the original static "phone ↔ 435ms ↔ AI" card with an
/// 8-section real-time command center:
///
///   1. Animated packet-flow illustration (replaces static dots)
///   2. Latency sparkline (30s rolling history)
///   3. Hub identity row (IP + source + signal bars)
///   4. Live SSE indicator (separate from HTTP)
///   5. Quick actions (Capture / Sync / Ping)
///   6. Connection health badge
///   7. AI activity feed (last 5 SSE events)
///   8. Session stats grid (2×2 tiles)
///
/// All driven by state.latencyHistory / state.sessionStats / state.activityFeed
/// populated by the ConnectionMetricsService through the BLoC.
class ConnectionHero extends StatelessWidget {
  const ConnectionHero({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ScreenCaptureBloc, ScreenCaptureState>(
      builder: (context, state) {
        final online = state.hubOnline == true;
        final checking = state.hubOnline == null || state.discovering;
        final metrics = context.read<ScreenCaptureBloc>().metrics;
        final health = metrics.classifyHealth(
          online: online,
          latestMs: state.hubLatencyMs,
        );

        return GlassPanel(
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Row 1: status pill + health badge + SSE indicator.
              Row(
                children: [
                  _StatusPill(
                    online: online,
                    checking: checking,
                    latencyMs: state.hubLatencyMs,
                  ),
                  const Spacer(),
                  LiveSseIndicator(connected: state.liveConnected),
                  const SizedBox(width: 6),
                  _HealthBadge(health: health),
                ],
              ),
              const SizedBox(height: 14),
              // Row 2: the link illustration.
              PacketFlowIllustration(
                online: online,
                latencyMs: state.hubLatencyMs,
              ),
              const SizedBox(height: 8),
              // Row 3: hub identity + sparkline.
              HubIdentityRow(
                hubUrl: state.hubUrl,
                hubOnline: state.hubOnline,
                hubSource: state.hubSource,
                health: health,
                latencyMs: state.hubLatencyMs,
              ),
              const SizedBox(height: 10),
              LatencySparkline(samples: state.latencyHistory),
              const SizedBox(height: 14),
              // Row 4: quick actions.
              QuickActionsRow(
                hubOnline: state.hubOnline,
                unsyncedCount: state.unsyncedCount,
              ),
              const SizedBox(height: 14),
              _Divider(color: Theme.of(context).dividerColor),
              const SizedBox(height: 12),
              // Row 5: session stats grid.
              SessionStatsGrid(stats: state.sessionStats),
              const SizedBox(height: 14),
              _Divider(color: Theme.of(context).dividerColor),
              const SizedBox(height: 10),
              // Row 6: AI activity feed header + body.
              const _SectionHeader(label: 'AI activity'),
              const SizedBox(height: 8),
              AIActivityFeed(events: state.activityFeed),
            ],
          ),
        );
      },
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({
    required this.online,
    required this.checking,
    required this.latencyMs,
  });
  final bool online;
  final bool checking;
  final int? latencyMs;

  @override
  Widget build(BuildContext context) {
    final color = online
        ? AppTheme.success
        : (checking ? AppTheme.primary : AppTheme.danger);
    final label = online
        ? 'CONNECTED'
        : (checking ? 'CONNECTING' : 'OFFLINE');
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
          Text(
            '$label · ${latencyMs ?? '—'}ms',
            style: AppTheme.microLabel.copyWith(color: color),
          ),
        ],
      ),
    );
  }
}

class _HealthBadge extends StatelessWidget {
  const _HealthBadge({required this.health});
  final LinkHealth health;

  @override
  Widget build(BuildContext context) {
    final color = switch (health) {
      LinkHealth.excellent => AppTheme.success,
      LinkHealth.good => AppTheme.primary,
      LinkHealth.slow => AppTheme.warning,
      LinkHealth.poor => AppTheme.danger,
      LinkHealth.offline => AppTheme.danger,
    };
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

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    return Text(
      label.toUpperCase(),
      style: AppTheme.microLabel.copyWith(
        color: AppTheme.darkTextDim,
        fontSize: 8.5,
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  const _Divider({required this.color});
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(height: 1, color: color.withValues(alpha: 0.5));
  }
}
