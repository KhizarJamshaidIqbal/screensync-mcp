import 'package:flutter/material.dart';

import '../../core/app_theme.dart';
import '../../widgets/ref_widgets.dart';
import '../dashboard/detail_cards.dart';
import 'step_shell.dart';

/// Step 4: recap + what's-next checklist.
class DoneStep extends StatelessWidget {
  const DoneStep({
    super.key,
    required this.simpleMode,
    required this.onFinish,
  });

  final bool simpleMode;
  final VoidCallback onFinish;

  @override
  Widget build(BuildContext context) {
    return StepShell(
      icon: Icons.rocket_launch_rounded,
      title: 'You\'re all set!',
      subtitle: simpleMode
          ? 'Simple mode is on. Start the bubble from the dashboard, tap it to capture, and find every frame in your Gallery.'
          : 'Start the bubble, capture a frame, then copy the Connect Kit into Claude — it will see your screen and publish findings back here.',
      children: [
        GlassPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SectionHeader(
                icon: Icons.flag_rounded,
                gradient: AppTheme.gradGreen,
                title: 'What\'s next',
              ),
              const SizedBox(height: 12),
              _nextRow(Icons.play_arrow_rounded, 'Start the floating bubble'),
              _nextRow(Icons.touch_app_rounded,
                  'Tap = capture · long-press = crop a region'),
              if (!simpleMode)
                _nextRow(Icons.hub_rounded,
                    'MCP page → Copy Connect Kit → paste into Claude'),
              _nextRow(Icons.photo_library_rounded,
                  'Every capture lands in your Gallery instantly'),
            ],
          ),
        ),
      ],
      cta: GradientActionButton(
        icon: Icons.auto_awesome_rounded,
        label: 'Open ScreenSync',
        gradient: AppTheme.gradGreen,
        onTap: onFinish,
      ),
    );
  }

  Widget _nextRow(IconData icon, String text) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(
          children: [
            Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(
                color: AppTheme.primary.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Icon(icon, size: 15, color: AppTheme.primary),
            ),
            const SizedBox(width: 10),
            Expanded(child: Text(text, style: AppTheme.typeBody)),
          ],
        ),
      );
}
