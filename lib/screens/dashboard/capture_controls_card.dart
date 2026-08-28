import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../../core/app_theme.dart';
import '../../services/media_projection_service.dart';
import '../../widgets/ref_widgets.dart';
import 'detail_cards.dart';

/// Capture controls in the reference style: glossy header tile, violet pause
/// switch and micro-label legend for the notification quick actions.
class CaptureControlsCard extends StatefulWidget {
  const CaptureControlsCard({super.key});

  @override
  State<CaptureControlsCard> createState() => _CaptureControlsCardState();
}

class _CaptureControlsCardState extends State<CaptureControlsCard> {
  bool _paused = false;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    final paused = await MediaProjectionService.isPaused();
    if (mounted) setState(() { _paused = paused; _loaded = true; });
  }

  Future<void> _toggle(bool paused) async {
    setState(() => _paused = paused);
    await MediaProjectionService.setPaused(paused);
    await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final text = dark ? const Color(0xFFF2EEFB) : const Color(0xFF221A38);
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
              icon: Icons.tune_rounded,
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFFD97706), Color(0xFFFBBF24)],
              ),
              title: 'Capture controls'),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Pause captures',
                        style: AppTheme.typeTitleMedium.copyWith(color: text)),
                    const SizedBox(height: 3),
                    Text(
                      _paused
                          ? 'Paused — taps and snaps are ignored until resumed.'
                          : 'Temporarily ignore bubble taps and snaps.',
                      style: AppTheme.typeBodyMedium
                          .copyWith(color: AppTheme.darkTextDim),
                    ),
                  ],
                ),
              ),
              Switch(
                value: _paused,
                onChanged: _loaded ? _toggle : null,
                activeColor: AppTheme.primary,
                activeTrackColor: AppTheme.primary.withValues(alpha: 0.3),
                inactiveTrackColor:
                    dark ? AppTheme.darkSurfaceAlt : AppTheme.lightSurfaceAlt,
              ),
            ],
          ),
          const SizedBox(height: 8),
          const MicroLabel('Notification quick actions'),
          const SizedBox(height: 10),
          _actionRow(Icons.camera_alt_rounded, 'Snap',
              'Capture now, even with the app closed'),
          _actionRow(Icons.bolt_rounded, 'MCP',
              'Flag the capture for the connected AI agent'),
          _actionRow(Icons.pause_rounded, 'Pause',
              'Same switch as above — mirrored in the notification'),
        ],
      ),
    ).animate().fadeIn(duration: 240.ms);
  }

  Widget _actionRow(IconData icon, String label, String hint) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          children: [
            Container(
              width: 26,
              height: 26,
              decoration: BoxDecoration(
                color: AppTheme.primary.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(icon, size: 13, color: AppTheme.primary),
            ),
            const SizedBox(width: 10),
            SizedBox(
              width: 46,
              child: Text(label,
                  style: AppTheme.typeBodyMedium.copyWith(
                      fontWeight: FontWeight.w700,
                      color: Theme.of(context).brightness == Brightness.dark
                          ? const Color(0xFFF2EEFB)
                          : const Color(0xFF221A38))),
            ),
            Expanded(
              child: Text(hint,
                  style: AppTheme.typeBodyMedium
                      .copyWith(color: AppTheme.darkTextDim)),
            ),
          ],
        ),
      );
}
