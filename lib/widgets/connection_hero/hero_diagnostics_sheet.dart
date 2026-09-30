import 'package:flutter/material.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../repositories/sync_mode.dart';
import '../../services/connection_metrics_service.dart';
import 'hero_parts.dart';
import 'hero_status_row.dart';
import 'latency_sparkline.dart';

// ── Diagnostics bottom sheet (feature 7) ──────────────────────────────────

class HeroDiagnosticsSheet extends StatelessWidget {
  const HeroDiagnosticsSheet({
    super.key,
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
                      .copyWith(color: linkHealthColor(health))),
              const SizedBox(height: 16),
              const HeroSectionHeader(label: 'Latency'),
              const SizedBox(height: 8),
              LatencySparkline(
                samples: state.latencyHistory,
                height: 56,
                p50: metrics.p50,
                p95: metrics.p95,
              ),
              const SizedBox(height: 12),
              _DiagRow('p50', heroMs(metrics.p50)),
              _DiagRow('p95', heroMs(metrics.p95)),
              _DiagRow('Jitter', heroMs(metrics.jitter)),
              _DiagRow('Average', heroMs(metrics.averageLatency)),
              _DiagRow('Peak', heroMs(metrics.peakLatency)),
              _DiagRow('Dropped frames', '${metrics.droppedFrames}'),
              const SizedBox(height: 16),
              const HeroSectionHeader(label: 'Hub'),
              const SizedBox(height: 8),
              _DiagRow('URL', state.hubUrl.isEmpty ? '—' : state.hubUrl),
              _DiagRow('Source',
                  state.hubSource.isEmpty ? '—' : state.hubSource),
              _DiagRow('Protocol / mode', _syncModeLabel(state.syncMode)),
              _DiagRow('Live (SSE)', state.liveConnected ? 'connected' : 'off'),
              _DiagRow('Pairing token',
                  state.hubAuthFailed ? 'rejected by hub' : 'accepted'),
              _DiagRow('Latest frame', state.framesFresh ? 'recent' : 'none yet'),
              _DiagRow('Screen capture', state.captureReady ? 'active' : 'off'),
              _DiagRow('Latest', heroMs(state.hubLatencyMs)),
              _DiagRow('Unsynced', '${state.unsyncedCount}'),
            ],
          ),
        );
      },
    );
  }

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
