import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../widgets/common_widgets.dart';

/// Live-mirror switch (phone screen -> hub) plus its honest status line.
///
/// Turning it on asks for screen-capture permission first; if that is refused
/// the switch falls back to off. If the mirror is on but Android has ended the
/// capture session (a restart, or the user revoked it) the tile says so in
/// amber and offers a "Grant screen capture" button instead of pretending
/// frames are flowing.
class LiveMirrorTile extends StatelessWidget {
  const LiveMirrorTile({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ScreenCaptureBloc, ScreenCaptureState>(
      buildWhen: (p, c) =>
          p.liveMirrorEnabled != c.liveMirrorEnabled ||
          p.consentPending != c.consentPending ||
          p.mirrorWaiting != c.mirrorWaiting ||
          p.captureReady != c.captureReady,
      builder: (context, state) {
        final waiting = state.liveMirrorEnabled &&
            state.mirrorWaiting &&
            !state.captureReady;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: const Text('Live mirror (this phone to the hub)',
                  style: TextStyle(fontSize: 13)),
              subtitle: Text(
                  state.consentPending
                      ? 'Waiting for you to allow screen capture…'
                      : 'While on, a low-latency 480p frame is pushed every '
                          'few seconds so the hub and any connected agent see '
                          'this screen as it changes. Turning it on asks for '
                          'screen capture permission. Phone-only switch - no '
                          'MCP tool can turn it on.',
                  style: TextStyle(fontSize: 11, color: dimColor(context))),
              value: state.liveMirrorEnabled || state.consentPending,
              onChanged: state.consentPending
                  ? null
                  : (v) => context
                      .read<ScreenCaptureBloc>()
                      .add(SetLiveMirrorEvent(v)),
            ),
            if (waiting)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 10,
                  runSpacing: 4,
                  children: [
                    const Icon(Icons.warning_amber_rounded,
                        size: 16, color: AppTheme.warning),
                    const Text(
                      'Waiting for screen capture - no frames are sent.',
                      style:
                          TextStyle(fontSize: 11, color: AppTheme.warning),
                    ),
                    OutlinedButton.icon(
                      onPressed: () => context
                          .read<ScreenCaptureBloc>()
                          .add(const GrantScreenCaptureEvent()),
                      icon: const Icon(Icons.screen_share_rounded, size: 16),
                      label: const Text('Grant screen capture'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppTheme.warning,
                        side: BorderSide(
                            color: AppTheme.warning.withValues(alpha: 0.6)),
                        visualDensity: VisualDensity.compact,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        );
      },
    );
  }
}
