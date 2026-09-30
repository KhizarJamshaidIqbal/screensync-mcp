import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../widgets/ref_widgets.dart';

/// Reference bubble card: glossy tile (violet standby / green running),
/// serif italic state line, STANDBY/RUNNING chip, gradient CTA.
///
/// "Running" only tells that the bubble window is up. Capture also needs a live
/// MediaProjection session, which Android ends independently (revoked, process
/// restart), so the card shows an amber "screen capture not active" state with
/// a re-grant button instead of claiming the bubble works.
class BubbleStatusCard extends StatelessWidget {
  const BubbleStatusCard({
    super.key,
    required this.running,
    this.captureReady = true,
    this.consentPending = false,
  });

  final bool running;

  /// A screen-capture session is live (see `ScreenCaptureState.captureReady`).
  final bool captureReady;

  /// A consent prompt is already open, so the re-grant button waits.
  final bool consentPending;

  @override
  Widget build(BuildContext context) {
    final noCapture = running && !captureReady;
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
                    icon: noCapture
                        ? Icons.videocam_off_rounded
                        : running
                            ? Icons.bubble_chart_rounded
                            : Icons.touch_app_rounded,
                    gradient: running && !noCapture
                        ? AppTheme.gradGreen
                        : AppTheme.gradPrimary,
                    size: 52,
                    iconSize: 24,
                  ),
                  if (running && !noCapture)
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
                        _StateChip(running: running, noCapture: noCapture),
                      ],
                    ),
                    Text.rich(
                      TextSpan(
                        style: TextStyle(
                          fontFamily: 'serif',
                          fontStyle: FontStyle.italic,
                          fontSize: 13,
                          color: noCapture
                              ? AppTheme.warning
                              : running
                                  ? AppTheme.success
                                  : AppTheme.darkTextDim,
                        ),
                        text: noCapture
                            ? 'screen capture not active'
                            : running
                                ? 'is active'
                                : 'off',
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      noCapture
                          ? 'The bubble is showing, but Android ended screen '
                              'capture. Grant it again before tapping the bubble.'
                          : running
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
          if (noCapture) ...[
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: consentPending
                    ? null
                    : () => context
                        .read<ScreenCaptureBloc>()
                        .add(const GrantScreenCaptureEvent()),
                icon: const Icon(Icons.screen_share_rounded, size: 18),
                label: const Text('Grant screen capture'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppTheme.warning,
                  side: BorderSide(
                      color: AppTheme.warning.withValues(alpha: 0.6)),
                  padding: const EdgeInsets.symmetric(vertical: 13),
                  shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(AppTheme.radiusM)),
                ),
              ),
            ),
            const SizedBox(height: 10),
          ],
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
  const _StateChip({required this.running, required this.noCapture});
  final bool running;
  final bool noCapture;

  @override
  Widget build(BuildContext context) {
    final color = noCapture
        ? AppTheme.warning
        : running
            ? AppTheme.success
            : AppTheme.primary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        noCapture
            ? 'NO CAPTURE'
            : running
                ? 'RUNNING'
                : 'STANDBY',
        style: AppTheme.microLabel.copyWith(color: color),
      ),
    );
  }
}
