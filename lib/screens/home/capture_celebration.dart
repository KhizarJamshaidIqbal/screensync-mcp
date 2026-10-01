import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../../core/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../annotate_screen.dart';

/// Animated capture-success card: shows the ACTUAL captured pixels so the
/// user gets instant proof the tap worked — even before any hub exists.
class CaptureCelebration extends StatelessWidget {
  const CaptureCelebration(
      {super.key, required this.framePath, required this.synced});

  final String? framePath;
  final bool synced;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Theme.of(context).brightness == Brightness.dark
              ? const Color(0xF0111827)
              : Colors.white,
          borderRadius: BorderRadius.circular(AppTheme.radiusL),
          border: Border.all(color: AppTheme.success.withValues(alpha: 0.65)),
          boxShadow: [
            BoxShadow(
              color: AppTheme.success.withValues(alpha: 0.25),
              blurRadius: 24,
              spreadRadius: 2,
            ),
          ],
        ),
        child: Row(
          children: [
            if (framePath != null && File(framePath!).existsSync())
              ClipRRect(
                borderRadius: BorderRadius.circular(AppTheme.radiusS),
                child: Image.file(
                  File(framePath!),
                  width: 46,
                  height: 82,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                ),
              )
            else
              Container(
                width: 46,
                height: 82,
                decoration: BoxDecoration(
                  color: AppTheme.success.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(AppTheme.radiusS),
                ),
                child: const Icon(Icons.image_rounded,
                    color: AppTheme.success, size: 22),
              ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.check_circle_rounded,
                          color: AppTheme.success, size: 18),
                      SizedBox(width: 6),
                      Text('Captured!',
                          style: TextStyle(
                              fontWeight: FontWeight.w800, fontSize: 15)),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    synced
                        ? 'Frame delivered — your AI can see it now.'
                        : 'Saved to Gallery. It will sync when the hub connects.',
                    style: TextStyle(fontSize: 12, color: dimColor(context)),
                  ),
                ],
              ),
            ),
            if (framePath != null)
              IconButton(
                tooltip: 'Annotate / redact',
                icon: const Icon(Icons.draw_rounded,
                    color: AppTheme.accentCyan, size: 22),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(
                      builder: (_) => AnnotateScreen(imagePath: framePath!)),
                ),
              ),
          ],
        ),
      ),
    )
        .animate()
        .slideY(begin: 0.4, end: 0, duration: 340.ms, curve: Curves.easeOutBack)
        .fadeIn(duration: 220.ms)
        .then(delay: 1900.ms)
        .fadeOut(duration: 350.ms);
  }
}
