import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../models/telemetry_event.dart';
import '../../widgets/common_widgets.dart';
import '../../widgets/ref_widgets.dart';
import '../dashboard/detail_cards.dart';

class TelemetryTab extends StatelessWidget {
  const TelemetryTab({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ScreenCaptureBloc, ScreenCaptureState>(
      builder: (context, state) {
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            GlassPanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: SectionHeader(
                          icon: Icons.monitor_heart_rounded,
                          gradient: AppTheme.gradGreen,
                          title: 'Performance telemetry',
                        ),
                      ),
                      MicroChip(
                          label: 'latency ms', color: AppTheme.primary),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Every hub interaction is measured end-to-end. Fast-mode '
                    'uploads should stay under 200ms on LAN.',
                    style: AppTheme.typeBodyMedium
                        .copyWith(color: AppTheme.darkTextDim),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: () => context
                          .read<ScreenCaptureBloc>()
                          .add(const ClearTelemetryEvent.clear()),
                      icon: const Icon(Icons.delete_sweep_rounded,
                          size: 18, color: AppTheme.danger),
                      label: const Text('Clear log',
                          style: TextStyle(color: AppTheme.danger)),
                      style: OutlinedButton.styleFrom(
                          side: const BorderSide(
                              color: AppTheme.danger, width: 1.2)),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            if (state.telemetry.isEmpty)
              GlassPanel(
                child: Column(
                  children: [
                    const GlossyTile(
                        icon: Icons.insights_rounded,
                        size: 52,
                        iconSize: 22,
                        gradient: AppTheme.gradGreen),
                    const SizedBox(height: 10),
                    Text(
                      'No telemetry yet — take a capture.',
                      style: TextStyle(
                        fontFamily: 'serif',
                        fontStyle: FontStyle.italic,
                        fontSize: 12.5,
                        color: AppTheme.darkTextDim,
                      ),
                    ),
                  ],
                ),
              )
            else
              for (final event in state.telemetry) TelemetryRow(event: event),
          ],
        );
      },
    );
  }
}

class TelemetryRow extends StatelessWidget {
  const TelemetryRow({super.key, required this.event});

  final TelemetryEvent event;

  @override
  Widget build(BuildContext context) {
    final color = switch (event.kind) {
      'upload' => AppTheme.primary,
      'discovery' => AppTheme.accentCyan,
      'vision' => AppTheme.secondary,
      'patch' => AppTheme.success,
      _ => Colors.grey,
    };
    return GlassPanel(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      borderRadius: AppTheme.radiusM,
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: color.withValues(alpha: 0.4)),
            ),
            child: Text('${event.durationMs} ms',
                style: TextStyle(
                    fontSize: 11,
                    color: color,
                    fontWeight: FontWeight.bold,
                    fontFamily: 'monospace')),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(event.label, maxLines: 2, overflow: TextOverflow.ellipsis),
                const SizedBox(height: 2),
                Text(
                  '${event.kind} · ${_clock(event.timestamp)}',
                  style: AppTheme.typeCaption
                      .copyWith(color: AppTheme.darkTextDim),
                ),
              ],
            ),
          ),
          Icon(
            event.ok ? Icons.check_circle_rounded : Icons.cancel_rounded,
            size: 18,
            color: event.ok ? AppTheme.success : AppTheme.danger,
          ),
        ],
      ),
    );
  }

  static String _clock(DateTime t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}:${t.second.toString().padLeft(2, '0')}';
}
