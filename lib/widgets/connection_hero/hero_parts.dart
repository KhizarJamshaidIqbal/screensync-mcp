import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../models/capture_quality.dart';
import '../../services/connection_metrics_service.dart';

// ── Mini-metrics ribbon (feature 6) ───────────────────────────────────────

class HeroMetricsRibbon extends StatelessWidget {
  const HeroMetricsRibbon({super.key, required this.metrics});
  final ConnectionMetricsService metrics;

  @override
  Widget build(BuildContext context) {
    final pills = <Widget>[
      _MetricPill(label: 'p50', value: heroMs(metrics.p50)),
      _MetricPill(label: 'p95', value: heroMs(metrics.p95)),
      _MetricPill(label: 'jitter', value: heroMs(metrics.jitter)),
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
}

/// Milliseconds label, or an em dash when there is no sample yet.
String heroMs(int? v) => v == null ? '—' : '${v}ms';

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

class HeroRecommendBanner extends StatelessWidget {
  const HeroRecommendBanner({
    super.key,
    required this.online,
    required this.health,
    required this.quality,
    required this.onRepair,
  });
  final bool online;
  final LinkHealth health;
  final CaptureQuality quality;

  /// Opens the pairing screen; offered when the hub rejects the token.
  final VoidCallback onRepair;

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
    } else if (health == LinkHealth.authProblem) {
      // The hub answers, but it refused a call that needs the pairing token.
      message = 'Hub rejected this phone’s pairing token — pair again';
      actionLabel = 'Re-pair';
      color = AppTheme.danger;
      action = onRepair;
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

// ── Shared small pieces ───────────────────────────────────────────────────

class HeroSectionHeader extends StatelessWidget {
  const HeroSectionHeader({super.key, required this.label});
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

class HeroDivider extends StatelessWidget {
  const HeroDivider({super.key, required this.color});
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(height: 1, color: color.withValues(alpha: 0.5));
  }
}
