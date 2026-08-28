import 'package:flutter/material.dart';

import '../../core/app_theme.dart';
import '../../widgets/ref_widgets.dart';
import 'step_shell.dart';

/// Step 3: overlay + notification permission grants with live status.
class PermissionsStep extends StatelessWidget {
  const PermissionsStep({
    super.key,
    required this.overlayGranted,
    required this.notifGranted,
    required this.onOverlayGrant,
    required this.onNotifGrant,
    required this.onNext,
  });

  final bool overlayGranted;
  final bool notifGranted;
  final Future<void> Function() onOverlayGrant;
  final Future<void> Function() onNotifGrant;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) {
    return StepShell(
      icon: Icons.verified_user_rounded,
      title: 'Two quick permissions',
      subtitle:
          'The floating bubble needs to sit above other apps, and a small notification keeps capture alive in the background.',
      children: [
        _permTile(
          granted: overlayGranted,
          icon: Icons.picture_in_picture_alt_rounded,
          title: 'Display over other apps',
          subtitle: 'Lets the capture bubble float above everything',
          onGrant: onOverlayGrant,
        ),
        const SizedBox(height: 10),
        _permTile(
          granted: notifGranted,
          icon: Icons.notifications_active_rounded,
          title: 'Notifications',
          subtitle: 'Shows capture status + quick Snap/Pause actions',
          onGrant: onNotifGrant,
        ),
      ],
      cta: GradientActionButton(
        icon: Icons.arrow_forward_rounded,
        label:
            overlayGranted && notifGranted ? 'Continue' : 'I\'ll do this later',
        gradient: overlayGranted && notifGranted
            ? AppTheme.gradPrimary
            : const LinearGradient(
                colors: [Color(0xFF6B6485), Color(0xFF9A93B8)]),
        onTap: onNext,
      ),
    );
  }

  Widget _permTile({
    required bool granted,
    required IconData icon,
    required String title,
    required String subtitle,
    required Future<void> Function() onGrant,
  }) {
    final tint = granted ? AppTheme.success : AppTheme.warning;
    return GlassPanel(
      borderColor: granted ? AppTheme.success.withValues(alpha: 0.5) : null,
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: tint.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, size: 19, color: tint),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, fontSize: 13)),
                const SizedBox(height: 2),
                Text(subtitle,
                    style: AppTheme.typeBodyMedium
                        .copyWith(color: AppTheme.darkTextDim)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          granted
              ? const MicroChip(
                  label: 'Granted',
                  color: AppTheme.success,
                  icon: Icons.check_rounded)
              : InkWell(
                  borderRadius: BorderRadius.circular(999),
                  onTap: onGrant,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      gradient: AppTheme.gradPrimary,
                      borderRadius: BorderRadius.circular(999),
                      boxShadow: [
                        BoxShadow(
                          color: AppTheme.primary.withValues(alpha: 0.4),
                          blurRadius: 8,
                          offset: const Offset(0, 3),
                        ),
                      ],
                    ),
                    child: const Text('Allow',
                        style: TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w700)),
                  ),
                ),
        ],
      ),
    );
  }
}
