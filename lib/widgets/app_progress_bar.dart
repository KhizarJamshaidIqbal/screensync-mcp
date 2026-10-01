import 'package:flutter/material.dart';

import '../core/app_theme.dart';

/// Brand progress bar: rounded track, violet gradient fill, animated with the
/// shared motion tokens. [value] is 0..1, or null for an indeterminate bar.
///
/// Use this instead of a bare [LinearProgressIndicator] so every progress
/// surface in the app looks the same in light and dark.
class AppProgressBar extends StatelessWidget {
  const AppProgressBar({super.key, this.value, this.height = 8});

  final double? value;
  final double height;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final track = dark ? AppTheme.darkBorder : AppTheme.lightBorder;
    final v = value?.clamp(0.0, 1.0);
    return Semantics(
      label: 'Progress',
      value: v == null ? null : '${(v * 100).floor()}%',
      child: ClipRRect(
        borderRadius: BorderRadius.circular(height),
        child: SizedBox(
          height: height,
          child: v == null
              ? LinearProgressIndicator(
                  minHeight: height,
                  backgroundColor: track,
                  color: AppTheme.primary,
                )
              : TweenAnimationBuilder<double>(
                  tween: Tween<double>(end: v),
                  duration: AppTheme.motionBase,
                  curve: AppTheme.motionStandard,
                  builder: (context, fill, _) => Stack(
                    fit: StackFit.expand,
                    children: [
                      ColoredBox(color: track),
                      FractionallySizedBox(
                        alignment: Alignment.centerLeft,
                        widthFactor: fill,
                        child: const DecoratedBox(
                          decoration:
                              BoxDecoration(gradient: AppTheme.gradPrimary),
                        ),
                      ),
                    ],
                  ),
                ),
        ),
      ),
    );
  }
}
