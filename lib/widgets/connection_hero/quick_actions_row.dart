import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';

/// 3-button quick-action row: Capture now, Sync pending, Ping hub.
/// Each fires the corresponding event on the BLoC. Haptic feedback is
/// handled inside the handlers.
class QuickActionsRow extends StatelessWidget {
  const QuickActionsRow({
    super.key,
    required this.hubOnline,
    required this.unsyncedCount,
  });

  final bool? hubOnline;
  final int unsyncedCount;

  @override
  Widget build(BuildContext context) {
    final isOnline = hubOnline == true;
    return Row(
      children: [
        Expanded(
          child: _ActionButton(
            icon: Icons.camera_alt_rounded,
            label: 'Capture',
            color: AppTheme.primary,
            onPressed: () => context
                .read<ScreenCaptureBloc>()
                .add(QuickCaptureRequestedEvent()),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _ActionButton(
            icon: Icons.cloud_sync_rounded,
            label: 'Sync',
            color: unsyncedCount > 0 ? AppTheme.warning : AppTheme.darkTextDim,
            badge: unsyncedCount > 0 ? '$unsyncedCount' : null,
            onPressed: () => context
                .read<ScreenCaptureBloc>()
                .add(QuickSyncRequestedEvent()),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _ActionButton(
            icon: Icons.wifi_tethering_rounded,
            label: 'Ping',
            color: isOnline ? AppTheme.success : AppTheme.darkTextDim,
            onPressed: () => context
                .read<ScreenCaptureBloc>()
                .add(QuickPingRequestedEvent()),
          ),
        ),
      ],
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onPressed,
    this.badge,
  });

  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onPressed;
  final String? badge;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(AppTheme.radiusM),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 6),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(AppTheme.radiusM),
            border: Border.all(color: color.withValues(alpha: 0.30)),
          ),
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, color: color, size: 18),
                  const SizedBox(height: 3),
                  Text(
                    label,
                    style: AppTheme.microLabel.copyWith(color: color),
                  ),
                ],
              ),
              if (badge != null)
                Positioned(
                  top: -4,
                  right: -4,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 4, vertical: 1),
                    decoration: BoxDecoration(
                      color: AppTheme.danger,
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(
                        color: Theme.of(context).scaffoldBackgroundColor,
                        width: 1.5,
                      ),
                    ),
                    child: Text(
                      badge!,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 9,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
