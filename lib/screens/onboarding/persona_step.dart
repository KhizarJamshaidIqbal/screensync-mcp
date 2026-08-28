import 'package:flutter/material.dart';

import '../../core/app_theme.dart';
import '../../widgets/ref_widgets.dart';
import 'step_shell.dart';

/// Step 1: persona routing (developer toolkit vs simple captures).
class PersonaStep extends StatelessWidget {
  const PersonaStep({
    super.key,
    required this.devPersona,
    required this.onSelect,
    required this.onNext,
  });

  final bool? devPersona;
  final ValueChanged<bool> onSelect;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) {
    return StepShell(
      icon: Icons.stream_rounded,
      title: 'Welcome to ScreenSync',
      subtitle:
          'Capture your phone screen with one tap and hand it straight to an AI on your desktop. First — how will you use it?',
      children: [
        _personaCard(
          context,
          selected: devPersona == true,
          icon: Icons.code_rounded,
          title: 'I\'m a developer',
          subtitle:
              'Full toolkit: MCP agent connection, bug heatmaps, git patches, telemetry.',
          onTap: () => onSelect(true),
        ),
        const SizedBox(height: 12),
        _personaCard(
          context,
          selected: devPersona == false,
          icon: Icons.photo_camera_rounded,
          title: 'I just want easy captures',
          subtitle:
              'Simple mode: bubble, gallery and sync. Developer surfaces stay hidden.',
          onTap: () => onSelect(false),
        ),
      ],
      cta: GradientActionButton(
        icon: Icons.arrow_forward_rounded,
        label: 'Continue',
        enabled: devPersona != null,
        onTap: onNext,
      ),
    );
  }

  Widget _personaCard(
    BuildContext context, {
    required bool selected,
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return InkWell(
      borderRadius: BorderRadius.circular(AppTheme.radiusL),
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: selected
              ? AppTheme.accentCyan.withValues(alpha: 0.10)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(AppTheme.radiusL),
          border: Border.all(
            color: selected
                ? AppTheme.accentCyan
                : Theme.of(context).dividerColor,
            width: selected ? 2 : 1,
          ),
        ),
        child: Row(
          children: [
            GlossyTile(
              icon: icon,
              gradient: selected
                  ? AppTheme.gradPrimary
                  : const LinearGradient(
                      colors: [Color(0xFF6B6485), Color(0xFF9A93B8)]),
              size: 46,
              iconSize: 22,
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: const TextStyle(
                          fontWeight: FontWeight.w700, fontSize: 15)),
                  const SizedBox(height: 3),
                  Text(subtitle,
                      style: AppTheme.typeBodyMedium.copyWith(
                          color: AppTheme.darkTextDim, height: 1.4)),
                ],
              ),
            ),
            Icon(
              selected
                  ? Icons.check_circle_rounded
                  : Icons.radio_button_off_rounded,
              color: selected ? AppTheme.primary : AppTheme.darkTextDim,
            ),
          ],
        ),
      ),
    );
  }
}
