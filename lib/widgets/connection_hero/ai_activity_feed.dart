import 'package:flutter/material.dart';

import '../../core/app_theme.dart';
import '../../services/connection_metrics_service.dart';

/// AI activity feed — last 5 events the hub pushed over SSE.
///
/// Empty state: a single dim line reading "Waiting for Claude…" so the
/// section never feels like a missing feature.
class AIActivityFeed extends StatelessWidget {
  const AIActivityFeed({super.key, required this.events});

  final List<ActivityEvent> events;

  @override
  Widget build(BuildContext context) {
    final visible = events.reversed.take(5).toList();
    if (visible.isEmpty) {
      return _WaitingState();
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < visible.length; i++) ...[
          if (i > 0) const SizedBox(height: 6),
          _ActivityRow(event: visible[i]),
        ],
      ],
    );
  }
}

class _WaitingState extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const _PulseDot(color: AppTheme.darkTextDim),
        const SizedBox(width: 8),
        Text(
          'Waiting for Claude…',
          style: AppTheme.microLabel.copyWith(color: AppTheme.darkTextDim),
        ),
      ],
    );
  }
}

class _ActivityRow extends StatelessWidget {
  const _ActivityRow({required this.event});
  final ActivityEvent event;

  @override
  Widget build(BuildContext context) {
    final (icon, color) = _visualFor(event.kind);
    return Row(
      children: [
        Container(
          width: 22,
          height: 22,
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.12),
            shape: BoxShape.circle,
            border: Border.all(color: color.withValues(alpha: 0.35)),
          ),
          child: Icon(icon, color: color, size: 12),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            event.label,
            style: AppTheme.typeCaption.copyWith(
              color: const Color(0xFFCBD5E1),
              fontWeight: FontWeight.w600,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        const SizedBox(width: 6),
        Text(
          _relative(event.timestamp),
          style: AppTheme.microLabel.copyWith(
            color: AppTheme.darkTextDim,
            fontSize: 8.5,
          ),
        ),
      ],
    );
  }

  (IconData, Color) _visualFor(String kind) => switch (kind) {
        'inspection' => (Icons.search_rounded, AppTheme.warning),
        'patch' => (Icons.handyman_rounded, AppTheme.success),
        'frame' => (Icons.image_rounded, AppTheme.primary),
        'connected' => (Icons.link_rounded, AppTheme.success),
        'disconnected' => (Icons.link_off_rounded, AppTheme.danger),
        _ => (Icons.bolt_rounded, AppTheme.primary),
      };

  static String _relative(DateTime ts) {
    final diff = DateTime.now().difference(ts);
    if (diff.inSeconds < 5) return 'now';
    if (diff.inSeconds < 60) return '${diff.inSeconds}s';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m';
    if (diff.inHours < 24) return '${diff.inHours}h';
    return '${diff.inDays}d';
  }
}

class _PulseDot extends StatefulWidget {
  const _PulseDot({required this.color});
  final Color color;

  @override
  State<_PulseDot> createState() => _PulseDotState();
}

class _PulseDotState extends State<_PulseDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (_, __) => Container(
        width: 8,
        height: 8,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: widget.color.withValues(alpha: 0.5 + 0.5 * _c.value),
        ),
      ),
    );
  }
}
