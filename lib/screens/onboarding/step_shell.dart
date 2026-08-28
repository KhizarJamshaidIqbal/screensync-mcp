import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../../core/app_theme.dart';
import '../../widgets/ref_widgets.dart';

/// Shared animated shell for every onboarding step.
class StepShell extends StatelessWidget {
  const StepShell({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.children,
    required this.cta,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final List<Widget> children;
  final Widget cta;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
      children: [
        GlossyTile(
          icon: icon,
          gradient: AppTheme.gradPrimary,
          size: 84,
          iconSize: 38,
        )
            .animate()
            .scale(
                begin: const Offset(0.7, 0.7),
                end: const Offset(1, 1),
                duration: 400.ms,
                curve: Curves.easeOutBack)
            .fadeIn(),
        const SizedBox(height: 22),
        Text(title,
            textAlign: TextAlign.center,
            style: AppTheme.typeDisplay.copyWith(fontSize: 24))
            .animate()
            .fadeIn(delay: 80.ms),
        const SizedBox(height: 8),
        Text(subtitle,
            textAlign: TextAlign.center,
            style: AppTheme.typeBody
                .copyWith(height: 1.5, color: AppTheme.darkTextDim))
            .animate()
            .fadeIn(delay: 140.ms),
        const SizedBox(height: 26),
        ...children,
        const SizedBox(height: 26),
        cta,
      ],
    );
  }
}
