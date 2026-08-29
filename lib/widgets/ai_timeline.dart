import 'package:flutter/material.dart';

import '../core/app_theme.dart';
import '../services/connection_metrics_service.dart';

/// B3: AI activity timeline — tool calls / frames / inspections as a live
/// log with timestamps and status chips.
class AiActivityTimeline extends StatelessWidget {
  const AiActivityTimeline({super.key, required this.events, this.maxRows = 8});

  final List<ActivityEvent> events;
  final int maxRows;

  @override
  Widget build(BuildContext context) {
    final rows = events.reversed.take(maxRows).toList();
    return GlassPanel(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.timeline_rounded,
                  size: 16, color: AppTheme.primary),
              SizedBox(width: 8),
              Expanded(
                child: Text('AI activity',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTheme.typeTitleMedium),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (rows.isEmpty)
            Text(
              'Tool calls and frames will appear here in real time.',
              style: AppTheme.typeCaption.copyWith(color: AppTheme.darkTextDim),
            )
          else
            for (final e in rows) _TimelineRow(event: e),
        ],
      ),
    );
  }
}

class _TimelineRow extends StatelessWidget {
  const _TimelineRow({required this.event});
  final ActivityEvent event;

  (IconData, Color, String) get _style => switch (event.kind) {
        'tool' => (Icons.build_rounded, AppTheme.primary, 'TOOL'),
        'frame' => (Icons.image_rounded, AppTheme.success, 'FRAME'),
        'inspection' => (Icons.bug_report_rounded, AppTheme.warning, 'INSPECT'),
        'patch' => (Icons.merge_rounded, AppTheme.accentMagenta, 'PATCH'),
        'connected' => (Icons.link_rounded, AppTheme.success, 'LINK'),
        'disconnected' => (Icons.link_off_rounded, AppTheme.danger, 'LINK'),
        _ => (Icons.bolt_rounded, AppTheme.darkTextDim, 'EVENT'),
      };

  String get _time {
    final t = event.timestamp;
    String two(int v) => v.toString().padLeft(2, '0');
    return '${two(t.hour)}:${two(t.minute)}:${two(t.second)}';
  }

  @override
  Widget build(BuildContext context) {
    final (icon, color, chip) = _style;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              event.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12),
            ),
          ),
          const SizedBox(width: 6),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(chip, style: AppTheme.microLabel.copyWith(color: color)),
          ),
          const SizedBox(width: 6),
          Text(_time,
              style:
                  AppTheme.typeCaption.copyWith(color: AppTheme.darkTextDim)),
        ],
      ),
    );
  }
}
