import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../core/app_theme.dart';
import '../core/motion.dart';
import '../models/frame_entry.dart';
import '../widgets/shimmer_box.dart';

/// B1: real-time thumbnail strip. Newest frames land at the head as SSE
/// `frame` events refresh the gallery. Tap → fullscreen pinch-zoom viewer.
class LiveStreamStrip extends StatelessWidget {
  const LiveStreamStrip({
    super.key,
    required this.frames,
    required this.live,
    this.maxThumbs = 12,
  });

  final List<FrameEntry> frames;
  final bool live;
  final int maxThumbs;

  @override
  Widget build(BuildContext context) {
    final visible = frames.take(maxThumbs).toList();
    return GlassPanel(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _LivePulseBadge(live: live),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  live ? 'Live stream' : 'Recent frames',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTheme.typeTitleMedium,
                ),
              ),
              Text(
                '${frames.length}',
                style:
                    AppTheme.typeCaption.copyWith(color: AppTheme.darkTextDim),
              ),
            ],
          ),
          const SizedBox(height: 10),
          SizedBox(
            height: 96,
            child: visible.isEmpty
                ? Row(
                    children: [
                      for (var i = 0; i < 3; i++) ...[
                        const ShimmerBox(width: 54, height: 96),
                        const SizedBox(width: 8),
                      ],
                      Expanded(
                        child: Text(
                          'Frames will appear here as they stream in.',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: AppTheme.typeCaption
                              .copyWith(color: AppTheme.darkTextDim),
                        ),
                      ),
                    ],
                  )
                : ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: visible.length,
                    separatorBuilder: (_, __) => const SizedBox(width: 8),
                    itemBuilder: (context, i) =>
                        _Thumb(entry: visible[i], isNewest: i == 0 && live),
                  ),
          ),
        ],
      ),
    );
  }
}

class _Thumb extends StatelessWidget {
  const _Thumb({required this.entry, required this.isNewest});
  final FrameEntry entry;
  final bool isNewest;

  @override
  Widget build(BuildContext context) {
    final path = entry.thumbPath.isNotEmpty ? entry.thumbPath : entry.filePath;
    final file = File(path);
    return Semantics(
      button: true,
      label: 'Open frame ${entry.filename} fullscreen',
      child: Tooltip(
        message: entry.filename,
        child: InkWell(
          borderRadius: BorderRadius.circular(AppTheme.radiusS),
          onTap: () => Navigator.of(context).push(MaterialPageRoute(
            fullscreenDialog: true,
            builder: (_) => FullscreenFrameViewer(entry: entry),
          )),
          child: Container(
            width: 54,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppTheme.radiusS),
              border: Border.all(
                color: isNewest
                    ? AppTheme.success.withValues(alpha: 0.8)
                    : Colors.transparent,
                width: 1.5,
              ),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(AppTheme.radiusS - 1.5),
              child: file.existsSync()
                  ? Image.file(file, fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => const _ThumbFallback())
                  : const _ThumbFallback(),
            ),
          ),
        ),
      ),
    );
  }
}

class _ThumbFallback extends StatelessWidget {
  const _ThumbFallback();
  @override
  Widget build(BuildContext context) => Container(
        color: AppTheme.primary.withValues(alpha: 0.10),
        child: const Icon(Icons.image_rounded,
            size: 18, color: AppTheme.darkTextDim),
      );
}

class _LivePulseBadge extends StatelessWidget {
  const _LivePulseBadge({required this.live});
  final bool live;

  @override
  Widget build(BuildContext context) {
    final color = live ? AppTheme.danger : AppTheme.darkTextDim;
    Widget dot = Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
    if (live && !reduceMotion(context)) {
      dot = dot
          .animate(onPlay: (c) => c.repeat(reverse: true))
          .fadeIn(duration: 600.ms)
          .scaleXY(begin: 0.8, end: 1.2, duration: 600.ms);
    }
    return Semantics(
      label: live ? 'Live stream active' : 'Stream idle',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: color.withValues(alpha: 0.4)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            dot,
            const SizedBox(width: 5),
            Text('LIVE',
                style: AppTheme.microLabel.copyWith(color: color)),
          ],
        ),
      ),
    );
  }
}

/// B1: fullscreen viewer with pinch-zoom (InteractiveViewer).
class FullscreenFrameViewer extends StatelessWidget {
  const FullscreenFrameViewer({super.key, required this.entry});
  final FrameEntry entry;

  @override
  Widget build(BuildContext context) {
    final file = File(entry.filePath);
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(
          entry.filename,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 13, color: Colors.white),
        ),
      ),
      body: Center(
        child: InteractiveViewer(
          minScale: 0.5,
          maxScale: 6,
          child: file.existsSync()
              ? Image.file(file, fit: BoxFit.contain)
              : const Icon(Icons.broken_image_rounded,
                  color: Colors.white38, size: 48),
        ),
      ),
    );
  }
}
