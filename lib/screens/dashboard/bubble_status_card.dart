import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../widgets/ref_widgets.dart';

/// Reference bubble card: glossy tile (violet standby / green running),
/// serif italic state line, STANDBY/RUNNING chip, gradient CTA.
class BubbleStatusCard extends StatelessWidget {
  const BubbleStatusCard({super.key, required this.running});

  final bool running;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).brightness == Brightness.dark
        ? const Color(0xFFF2EEFB)
        : const Color(0xFF221A38);
    return GlassPanel(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  GlossyTile(
                    icon: running
                        ? Icons.bubble_chart_rounded
                        : Icons.touch_app_rounded,
                    gradient:
                        running ? AppTheme.gradGreen : AppTheme.gradPrimary,
                    size: 52,
                    iconSize: 24,
                  ),
                  if (running)
                    Positioned(
                      right: -3,
                      top: -3,
                      child: Container(
                        width: 12,
                        height: 12,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: AppTheme.success,
                          border: Border.all(
                              color: AppTheme.lightSurface, width: 2),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Floating Bubble',
                            style: AppTheme.typeTitleLarge.copyWith(
                                color: text),
                          ),
                        ),
                        _StateChip(running: running),
                      ],
                    ),
                    Text.rich(
                      TextSpan(
                        style: TextStyle(
                          fontFamily: 'serif',
                          fontStyle: FontStyle.italic,
                          fontSize: 13,
                          color: running
                              ? AppTheme.success
                              : AppTheme.darkTextDim,
                        ),
                        text: running ? 'is active' : 'off',
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      running
                          ? 'Tap = capture · long-press = region · shake also works.'
                          : 'Enable the bubble to capture any app with your phone.',
                      style: AppTheme.typeBodyMedium
                          .copyWith(color: AppTheme.darkTextDim),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient:
                    running ? AppTheme.gradDanger : AppTheme.gradPrimary,
                borderRadius: BorderRadius.circular(AppTheme.radiusM),
                boxShadow: [
                  BoxShadow(
                    color: (running ? AppTheme.danger : AppTheme.primary)
                        .withValues(alpha: 0.4),
                    blurRadius: 14,
                    offset: const Offset(0, 6),
                  ),
                ],
              ),
              child: ElevatedButton.icon(
                onPressed: () => context.read<ScreenCaptureBloc>().add(
                      running
                          ? StopOverlayServiceEvent()
                          : StartOverlayServiceEvent(),
                    ),
                icon: Icon(
                    running
                        ? Icons.stop_rounded
                        : Icons.play_arrow_rounded,
                    size: 18),
                label: Text(running
                    ? 'Stop Floating Bubble'
                    : 'Start Floating Bubble'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.transparent,
                  shadowColor: Colors.transparent,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 15),
                  textStyle: const TextStyle(
                      fontSize: 14, fontWeight: FontWeight.w700),
                  shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(AppTheme.radiusM)),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _StateChip extends StatelessWidget {
  const _StateChip({required this.running});
  final bool running;

  @override
  Widget build(BuildContext context) {
    final color = running ? AppTheme.success : AppTheme.primary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        running ? 'RUNNING' : 'STANDBY',
        style: AppTheme.microLabel.copyWith(color: color),
      ),
    );
  }
}
