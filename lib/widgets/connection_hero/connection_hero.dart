import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../screens/pair_scan_screen.dart';
import '../../services/connection_metrics_service.dart';
import 'ai_activity_feed.dart';
import 'animated_gradient_border.dart';
import 'hero_diagnostics_sheet.dart';
import 'hero_parts.dart';
import 'hero_status_row.dart';
import 'hub_identity_row.dart';
import 'latency_sparkline.dart';
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
///
/// The link only reads "connected" while the hub also accepts this phone's
/// token: `/health` is unauthenticated, so a wrong token used to show a green,
/// "Excellent" hero while every real call failed with 401.
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

  void _openPairing(BuildContext context) {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => const PairScanScreen()));
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
          authFailed: state.hubAuthFailed,
        );

        final borderState = online
            ? (health == LinkHealth.slow ||
                    health == LinkHealth.poor ||
                    health == LinkHealth.authProblem
                ? GradientBorderState.connecting
                : GradientBorderState.online)
            : (checking
                ? GradientBorderState.connecting
                : GradientBorderState.offline);

        final showBanner = !online ||
            health == LinkHealth.slow ||
            health == LinkHealth.poor ||
            health == LinkHealth.authProblem;

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
                    // Row 1: status pill + SSE + the single health badge.
                    HeroStatusRow(
                      online: online,
                      checking: checking,
                      latencyMs: state.hubLatencyMs,
                      liveConnected: state.liveConnected,
                      health: health,
                      authFailed: state.hubAuthFailed,
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
                    HeroMetricsRibbon(metrics: metrics),
                    const SizedBox(height: 8),
                    if (showBanner) ...[
                      HeroRecommendBanner(
                        online: online,
                        health: health,
                        quality: state.quality,
                        onRepair: () => _openPairing(context),
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
                    HeroDivider(color: Theme.of(context).dividerColor),
                    const SizedBox(height: 12),
                    SessionStatsGrid(stats: state.sessionStats),
                    const SizedBox(height: 14),
                    HeroDivider(color: Theme.of(context).dividerColor),
                    const SizedBox(height: 10),
                    const HeroSectionHeader(label: 'AI activity'),
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
      builder: (_) => HeroDiagnosticsSheet(
        state: state,
        metrics: metrics,
        health: health,
      ),
    );
  }
}
