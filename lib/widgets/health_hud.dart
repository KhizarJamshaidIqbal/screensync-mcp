import 'package:flutter/material.dart';

import '../core/app_theme.dart';

/// B2: compact latency/health mini-HUD — p50 / p95 / jitter / dropped.
/// Pure widget (takes precomputed numbers) so it's trivially testable and
/// never overflows: metrics are laid out with [Wrap].
class HealthHud extends StatelessWidget {
  const HealthHud({
    super.key,
    required this.p50,
    required this.p95,
    required this.jitter,
    required this.dropped,
  });

  final int? p50;
  final int? p95;
  final int? jitter;
  final int dropped;

  String _ms(int? v) => v == null ? '—' : '${v}ms';

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Connection health: median latency ${_ms(p50)}, '
          '95th percentile ${_ms(p95)}, jitter ${_ms(jitter)}, '
          '$dropped dropped frames',
      child: GlassPanel(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        borderRadius: AppTheme.radiusM,
        child: Wrap(
          spacing: 14,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            _Metric(label: 'P50', value: _ms(p50), color: AppTheme.success),
            _Metric(label: 'P95', value: _ms(p95), color: AppTheme.warning),
            _Metric(label: 'JITTER', value: _ms(jitter), color: AppTheme.primary),
            _Metric(
              label: 'DROPPED',
              value: '$dropped',
              color: dropped > 0 ? AppTheme.danger : AppTheme.darkTextDim,
            ),
          ],
        ),
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value, required this.color});
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 6,
          height: 6,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 5),
        Text(label, style: AppTheme.microLabel.copyWith(color: AppTheme.darkTextDim)),
        const SizedBox(width: 4),
        Text(value,
            style: const TextStyle(
                fontSize: 12, fontWeight: FontWeight.w700,
                fontFeatures: [FontFeature.tabularFigures()])),
      ],
    );
  }
}
