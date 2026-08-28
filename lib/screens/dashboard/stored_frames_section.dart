import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../models/frame_entry.dart';
import '../../services/device_intent_service.dart';
import '../../widgets/ref_widgets.dart';

/// Reference "STORED FRAMES · N saved" section: vertical capture cards with
/// thumbnail, meta and synced/LAN chips; glossy camera empty state.
class StoredFramesSection extends StatelessWidget {
  const StoredFramesSection({
    super.key,
    required this.frames,
    required this.visibleCount,
    required this.onLoadMore,
  });

  final List<FrameEntry> frames;
  final int visibleCount;
  final VoidCallback onLoadMore;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHead(
          title: 'Stored Frames',
          accent: frames.isEmpty
              ? 'Nothing yet'
              : '${frames.length} saved',
        ),
        const SizedBox(height: 12),
        if (frames.isEmpty)
          _EmptyCapture(onStart: () => context
              .read<ScreenCaptureBloc>()
              .add(StartOverlayServiceEvent()))
        else ...[
          ...frames.take(visibleCount).map((f) => _FrameCard(entry: f)),
          if (visibleCount < frames.length)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Center(
                child: TextButton(
                  onPressed: onLoadMore,
                  child: Text(
                    'Load more (${frames.length - visibleCount} left)',
                    style: const TextStyle(
                        fontFamily: 'serif', fontStyle: FontStyle.italic),
                  ),
                ),
              ),
            ),
        ],
      ],
    );
  }
}

class _EmptyCapture extends StatelessWidget {
  const _EmptyCapture({required this.onStart});
  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const GlossyTile(
          icon: Icons.photo_camera_rounded,
          size: 64,
          iconSize: 26,
        ),
        const SizedBox(height: 12),
        const Text(
          'No captures yet.',
          style: TextStyle(
            fontFamily: 'serif',
            fontStyle: FontStyle.italic,
            fontSize: 13,
            color: AppTheme.darkTextDim,
          ),
        ),
        const SizedBox(height: 14),
        SizedBox(
          width: double.infinity,
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: AppTheme.gradPrimary,
              borderRadius: BorderRadius.circular(AppTheme.radiusM),
              boxShadow: [
                BoxShadow(
                  color: AppTheme.primary.withValues(alpha: 0.4),
                  blurRadius: 14,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: ElevatedButton.icon(
              onPressed: onStart,
              icon: const Icon(Icons.play_arrow_rounded, size: 18),
              label: const Text('Start Floating Bubble'),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.transparent,
                shadowColor: Colors.transparent,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                textStyle: const TextStyle(
                    fontSize: 13.5, fontWeight: FontWeight.w700),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(AppTheme.radiusM)),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _FrameCard extends StatelessWidget {
  const _FrameCard({required this.entry});
  final FrameEntry entry;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: GlassPanel(
        padding: const EdgeInsets.all(10),
        borderRadius: AppTheme.radiusM,
        child: InkWell(
          borderRadius: BorderRadius.circular(AppTheme.radiusM),
          onLongPress: () =>
              DeviceIntentService.shareImage(entry.filePath),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: Image.file(
                  File(entry.thumbPath),
                  width: 52,
                  height: 68,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => Container(
                    width: 52,
                    height: 68,
                    color: dark
                        ? AppTheme.darkSurfaceAlt
                        : AppTheme.lightSurfaceAlt,
                    child: const Icon(Icons.broken_image_outlined,
                        size: 18, color: AppTheme.darkTextDim),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      entry.filename,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTheme.typeBodyMedium.copyWith(
                        fontWeight: FontWeight.w600,
                        color: dark
                            ? const Color(0xFFF2EEFB)
                            : const Color(0xFF221A38),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      entry.sizeLabel,
                      style: AppTheme.typeTitleMedium.copyWith(
                          color: AppTheme.primary),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${_ago(entry.capturedAt)} · ${entry.width}×${entry.height}',
                      style: AppTheme.typeCaption
                          .copyWith(color: AppTheme.darkTextDim),
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        _Chip(
                          label: entry.syncedHub ? 'synced' : 'pending',
                          color: entry.syncedHub
                              ? AppTheme.success
                              : AppTheme.warning,
                          icon: entry.syncedHub
                              ? Icons.check_rounded
                              : Icons.schedule_rounded,
                        ),
                        const SizedBox(width: 6),
                        _Chip(
                            label: entry.syncedDrive
                                ? 'Drive'
                                : 'LAN',
                            color: AppTheme.primary),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _ago(DateTime at) {
    final mins = DateTime.now().difference(at).inMinutes;
    if (mins < 1) return 'Just now';
    if (mins < 60) return '${mins}m ago';
    return '${mins ~/ 60}h ago';
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.color, this.icon});
  final String label;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 10, color: color),
            const SizedBox(width: 3),
          ],
          Text(
            label,
            style: AppTheme.microLabel.copyWith(color: color),
          ),
        ],
      ),
    );
  }
}
