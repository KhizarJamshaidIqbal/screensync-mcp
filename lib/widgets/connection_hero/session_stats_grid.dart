import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../services/connection_metrics_service.dart';

/// 2×2 session stats grid:
///   Captures today  |  Pushed to hub
///   Unsynced        |  Last AI response
///
/// Unsynced is tappable — fires RetryUnsyncedRequestedEvent so the user
/// can re-attempt the upload from the hero without scrolling.
class SessionStatsGrid extends StatelessWidget {
  const SessionStatsGrid({super.key, required this.stats});

  final SessionStats stats;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: _StatTile(
                icon: Icons.camera_alt_rounded,
                label: 'Captures today',
                value: '${stats.capturesToday}',
                color: AppTheme.primary,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _StatTile(
                icon: Icons.cloud_upload_rounded,
                label: 'Pushed to hub',
                value: '${stats.pushedHub + stats.pushedDrive}',
                color: AppTheme.success,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: _UnsyncedTile(count: stats.unsynced),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _StatTile(
                icon: Icons.auto_awesome_rounded,
                label: 'Last AI response',
                value: _relativeLabel(stats.lastAIResponse),
                color: stats.lastAIResponse != null
                    ? AppTheme.accentCyan
                    : AppTheme.darkTextDim,
              ),
            ),
          ],
        ),
      ],
    );
  }

  static String _relativeLabel(DateTime? ts) {
    if (ts == null) return '—';
    final diff = DateTime.now().difference(ts);
    if (diff.inSeconds < 5) return 'just now';
    if (diff.inSeconds < 60) return '${diff.inSeconds}s ago';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    return '${diff.inDays}d ago';
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });
  final IconData icon;
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 9, 10, 9),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(AppTheme.radiusM),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Icon(icon, size: 13, color: color),
              const SizedBox(width: 5),
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTheme.microLabel.copyWith(
                    color: AppTheme.darkTextDim,
                    fontSize: 8.5,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: color,
              fontSize: 15,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _UnsyncedTile extends StatelessWidget {
  const _UnsyncedTile({required this.count});
  final int count;

  @override
  Widget build(BuildContext context) {
    final color = count > 0 ? AppTheme.warning : AppTheme.success;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: count > 0
            ? () => context
                .read<ScreenCaptureBloc>()
                .add(RetryUnsyncedRequestedEvent())
            : null,
        borderRadius: BorderRadius.circular(AppTheme.radiusM),
        child: Container(
          padding: const EdgeInsets.fromLTRB(10, 9, 10, 9),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.06),
            borderRadius: BorderRadius.circular(AppTheme.radiusM),
            border: Border.all(color: color.withValues(alpha: 0.25)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Icon(Icons.cloud_off_rounded, size: 13, color: color),
                  const SizedBox(width: 5),
                  Expanded(
                    child: Text(
                      'Unsynced',
                      style: AppTheme.microLabel.copyWith(
                        color: AppTheme.darkTextDim,
                        fontSize: 8.5,
                      ),
                    ),
                  ),
                  if (count > 0)
                    Icon(Icons.refresh_rounded, size: 11, color: color),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                '$count',
                style: TextStyle(
                  color: color,
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
