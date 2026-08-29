import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../models/capture_quality.dart';
import '../../repositories/sync_mode.dart';
import '../../services/connection_metrics_service.dart';
import 'ai_activity_feed.dart';
import 'animated_gradient_border.dart';
import 'hub_identity_row.dart';
import 'latency_sparkline.dart';
import 'live_sse_indicator.dart';
import 'packet_flow_illustration.dart';
import 'quick_actions_row.dart';
import 'session_stats_grid.dart';

/// ConnectionHero 2.0 — "Live Bridge" (modernised).
///
/// Additive upgrade over the original 8-section command center:
///  - Glassmorphism + animated gradient border reflecting link state.
///  - Breathing AI orb + reactive/bidirectional packet flow.
///  - Live latency grade chip, mini-metrics ribbon.
///  - Tap → draggable diagnostics bottom sheet.
///  - Auto-recommend banner on slow/poor/offline links.
///  - Haptics on connect/disconnect transitions.
class ConnectionHero extends StatefulWidget {
  const ConnectionHero({super.key});

  @override
  State<ConnectionHero> createState() => _ConnectionHeroState();
}

class _ConnectionHeroState extends State<ConnectionHero> {
  bool? _prevOnline;
  int _activityLen = 0;
  Object _activityPulseKey = 0;
  Object _flashPulseKey = 0;

  void _onNewState(ScreenCaptureState state) {
    final online = state.hubOnline == true;
    // Haptics on transition.
    if (_prevOnline != null && _prevOnline != online) {
      if (online) {
        HapticFeedback.lightImpact();
      } else {
        HapticFeedback.mediumImpact();
      }
    }
    _prevOnline = online;

    // Activity pulse / camera-flash detection.
    final feed = state.activityFeed;
    if (feed.length != _activityLen) {
      _activityLen = feed.length;
      _activityPulseKey = Object();
      if (feed.isNotEmpty) {
        final kind = feed.last.kind;
        if (kind == 'frame' || kind == 'inspection') {
          _flashPulseKey = Object();
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return BlocConsumer<ScreenCaptureBloc, ScreenCaptureState>(
      listener: (context, state) => setState(() => _onNewState(state)),
      builder: (context, state) {
        final online = state.hubOnline == true;
        final checking = state.hubOnline == null || state.discovering;
        final metrics = context.read<ScreenCaptureBloc>().metrics;
        final health = metrics.classifyHealth(
          online: online,
          latestMs: state.hubLatencyMs,
        );

        final borderState = online
            ? (health == LinkHealth.slow || health == LinkHealth.poor
                ? GradientBorderState.connecting
                : GradientBorderState.online)
            : (checking
                ? GradientBorderState.connecting
                : GradientBorderState.offline);

        final showBanner =
            !online || health == LinkHealth.slow || health == LinkHealth.poor;

        return AnimatedGradientBorder(
          state: borderState,
          child: GlassPanel(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
            child: Semantics(
              button: true,
              label: 'Connection status. Tap for full diagnostics.',
              child: InkWell(
                borderRadius: BorderRadius.circular(AppTheme.radiusM),
                onTap: () => _openDiagnostics(context, state, metrics, health),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Row 1: status pill + grade chip + SSE + health badge.
                    Row(
                      children: [
                        Flexible(
                          child: _StatusPill(
                            online: online,
                            checking: checking,
                            latencyMs: state.hubLatencyMs,
                          ),
                        ),
                        const SizedBox(width: 6),
                        _GradeChip(health: health),
                        const Spacer(),
                        LiveSseIndicator(connected: state.liveConnected),
                        const SizedBox(width: 6),
                        _HealthBadge(health: health),
                      ],
                    ),
                    const SizedBox(height: 14),
                    PacketFlowIllustration(
                      online: online,
                      latencyMs: state.hubLatencyMs,
                      jitter: metrics.jitter,
                      activityPulseKey: _activityPulseKey,
                      flashPulseKey: _flashPulseKey,
                      latestFramePath: state.latestFramePath,
                      deviceName: state.deviceName,
                      agentName: state.agentName,
                    ),
                    const SizedBox(height: 8),
                    // Mini-metrics ribbon.
                    _MetricsRibbon(metrics: metrics),
                    const SizedBox(height: 8),
                    if (showBanner) ...[
                      _RecommendBanner(
                        online: online,
                        health: health,
                        quality: state.quality,
                      ),
                      const SizedBox(height: 8),
                    ],
                    HubIdentityRow(
                      hubUrl: state.hubUrl,
                      hubOnline: state.hubOnline,
                      hubSource: state.hubSource,
                      health: health,
                      latencyMs: state.hubLatencyMs,
                    ),
                    const SizedBox(height: 10),
                    LatencySparkline(
                      samples: state.latencyHistory,
                      p50: metrics.p50,
                      p95: metrics.p95,
                    ),
                    const SizedBox(height: 14),
                    QuickActionsRow(
                      hubOnline: state.hubOnline,
                      unsyncedCount: state.unsyncedCount,
                    ),
                    const SizedBox(height: 14),
                    _Divider(color: Theme.of(context).dividerColor),
                    const SizedBox(height: 12),
                    SessionStatsGrid(stats: state.sessionStats),
                    const SizedBox(height: 14),
                    _Divider(color: Theme.of(context).dividerColor),
                    const SizedBox(height: 10),
                    const _SectionHeader(label: 'AI activity'),
                    const SizedBox(height: 8),
                    AIActivityFeed(events: state.activityFeed),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  void _openDiagnostics(
    BuildContext context,
    ScreenCaptureState state,
    ConnectionMetricsService metrics,
    LinkHealth health,
  ) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _DiagnosticsSheet(
        state: state,
        metrics: metrics,
        health: health,
      ),
    );
  }
}

// ── Grade chip (feature 5) ────────────────────────────────────────────────

class _GradeChip extends StatelessWidget {
  const _GradeChip({required this.health});
  final LinkHealth health;

  @override
  Widget build(BuildContext context) {
    final color = _colorFor(health);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.speed_rounded, size: 10, color: color),
          const SizedBox(width: 4),
          Text(
            health.label,
            style: AppTheme.microLabel.copyWith(color: color, fontSize: 9),
          ),
        ],
      ),
    );
  }
}

Color _colorFor(LinkHealth health) => switch (health) {
      LinkHealth.excellent => AppTheme.success,
      LinkHealth.good => AppTheme.primary,
      LinkHealth.slow => AppTheme.warning,
      LinkHealth.poor => AppTheme.danger,
      LinkHealth.offline => AppTheme.danger,
    };

// ── Mini-metrics ribbon (feature 6) ───────────────────────────────────────

class _MetricsRibbon extends StatelessWidget {
  const _MetricsRibbon({required this.metrics});
  final ConnectionMetricsService metrics;

  @override
  Widget build(BuildContext context) {
    final pills = <Widget>[
      _MetricPill(label: 'p50', value: _ms(metrics.p50)),
      _MetricPill(label: 'p95', value: _ms(metrics.p95)),
      _MetricPill(label: 'jitter', value: _ms(metrics.jitter)),
      _MetricPill(
        label: 'dropped',
        value: metrics.droppedFrames > 0 ? '${metrics.droppedFrames}' : '0',
      ),
    ];
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      alignment: WrapAlignment.center,
      children: pills,
    );
  }

  static String _ms(int? v) => v == null ? '—' : '${v}ms';
}

class _MetricPill extends StatelessWidget {
  const _MetricPill({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppTheme.primary.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppTheme.primary.withValues(alpha: 0.18)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label.toUpperCase(),
            style: AppTheme.microLabel
                .copyWith(color: AppTheme.darkTextDim, fontSize: 8),
          ),
          const SizedBox(width: 4),
          Text(
            value,
            style: AppTheme.microLabel
                .copyWith(color: AppTheme.primary, fontSize: 9),
          ),
        ],
      ),
    );
  }
}

// ── Auto-recommend banner (feature 10) ────────────────────────────────────

class _RecommendBanner extends StatelessWidget {
  const _RecommendBanner({
    required this.online,
    required this.health,
    required this.quality,
  });
  final bool online;
  final LinkHealth health;
  final CaptureQuality quality;

  @override
  Widget build(BuildContext context) {
    final bloc = context.read<ScreenCaptureBloc>();
    final String message;
    final String actionLabel;
    final VoidCallback? action;
    final Color color;

    if (!online) {
      message = 'Hub offline — retry connection';
      actionLabel = 'Retry';
      color = AppTheme.danger;
      action = () => bloc.add(AutoConnectHubEvent());
    } else {
      // slow / poor
      color = AppTheme.warning;
      // Recommend a lighter capture preset if not already on stream.
      if (quality != CaptureQuality.stream) {
        message = 'Link slow — try a faster preset';
        actionLabel = 'Fast';
        action = () => bloc.add(const SetQualityEvent(CaptureQuality.fast));
      } else {
        message = 'Link slow — already on lightest preset';
        actionLabel = 'Ping';
        action = () => bloc.add(QuickPingRequestedEvent());
      }
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(AppTheme.radiusS),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        children: [
          Icon(Icons.info_outline_rounded, size: 14, color: color),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppTheme.typeCaption.copyWith(color: color),
            ),
          ),
          const SizedBox(width: 8),
          Semantics(
            button: true,
            label: actionLabel,
            child: InkWell(
              onTap: action,
              borderRadius: BorderRadius.circular(999),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.18),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  actionLabel,
                  style: AppTheme.microLabel.copyWith(color: color),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// Bring CaptureQuality + event into scope for the banner.
// (imported transitively through bloc; explicit import below)

// ── Diagnostics bottom sheet (feature 7) ──────────────────────────────────

class _DiagnosticsSheet extends StatelessWidget {
  const _DiagnosticsSheet({
    required this.state,
    required this.metrics,
    required this.health,
  });
  final ScreenCaptureState state;
  final ConnectionMetricsService metrics;
  final LinkHealth health;

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.4,
      maxChildSize: 0.92,
      expand: false,
      builder: (context, scrollController) {
        final dark = Theme.of(context).brightness == Brightness.dark;
        return Container(
          decoration: BoxDecoration(
            color: dark ? AppTheme.darkSurface : AppTheme.lightSurface,
            borderRadius:
                const BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: ListView(
            controller: scrollController,
            padding: const EdgeInsets.fromLTRB(18, 10, 18, 24),
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 14),
                  decoration: BoxDecoration(
                    color: AppTheme.darkTextDim.withValues(alpha: 0.4),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Text('Link diagnostics',
                  style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 4),
              Text('Grade: ${health.label}',
                  style: AppTheme.typeCaption
                      .copyWith(color: _colorFor(health))),
              const SizedBox(height: 16),
              const _SectionHeader(label: 'Latency'),
              const SizedBox(height: 8),
              LatencySparkline(
                samples: state.latencyHistory,
                height: 56,
                p50: metrics.p50,
                p95: metrics.p95,
              ),
              const SizedBox(height: 12),
              _DiagRow('p50', _ms(metrics.p50)),
              _DiagRow('p95', _ms(metrics.p95)),
              _DiagRow('Jitter', _ms(metrics.jitter)),
              _DiagRow('Average', _ms(metrics.averageLatency)),
              _DiagRow('Peak', _ms(metrics.peakLatency)),
              _DiagRow('Dropped frames', '${metrics.droppedFrames}'),
              const SizedBox(height: 16),
              const _SectionHeader(label: 'Hub'),
              const SizedBox(height: 8),
              _DiagRow('URL', state.hubUrl.isEmpty ? '—' : state.hubUrl),
              _DiagRow('Source',
                  state.hubSource.isEmpty ? '—' : state.hubSource),
              _DiagRow('Protocol / mode', _syncModeLabel(state.syncMode)),
              _DiagRow('Live (SSE)', state.liveConnected ? 'connected' : 'off'),
              _DiagRow('Latest', _ms(state.hubLatencyMs)),
              _DiagRow('Unsynced', '${state.unsyncedCount}'),
            ],
          ),
        );
      },
    );
  }

  static String _ms(int? v) => v == null ? '—' : '${v}ms';

  static String _syncModeLabel(SyncMode m) => switch (m) {
        SyncMode.lanMdns => 'LAN (mDNS)',
        SyncMode.googleDrive => 'Google Drive',
        SyncMode.hybrid => 'Hybrid',
      };
}

class _DiagRow extends StatelessWidget {
  const _DiagRow(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(
              label,
              style: AppTheme.typeCaption
                  .copyWith(color: AppTheme.darkTextDim),
            ),
          ),
          Expanded(
            child: Text(
              value,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppTheme.typeCaption
                  .copyWith(fontFamily: 'monospace'),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Existing sub-widgets (unchanged) ──────────────────────────────────────

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
          Flexible(
            child: Text(
              '$label · ${latencyMs ?? '—'}ms',
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

class _HealthBadge extends StatelessWidget {
  const _HealthBadge({required this.health});
  final LinkHealth health;

  @override
  Widget build(BuildContext context) {
    final color = _colorFor(health);
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
