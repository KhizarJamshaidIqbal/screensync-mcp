import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../models/bug_region.dart';
import '../../widgets/common_widgets.dart';
import '../../widgets/ref_widgets.dart';
import '../dashboard/detail_cards.dart';

class DiagnoseTab extends StatelessWidget {
  const DiagnoseTab({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ScreenCaptureBloc, ScreenCaptureState>(
      builder: (context, state) {
        final framePath = state.latestFramePath;
        final patchText = state.patch?['patch'] as String?;
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            GlassPanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Expanded(
                        child: SectionHeader(
                          icon: Icons.bug_report_rounded,
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [Color(0xFFD97706), Color(0xFFFBBF24)],
                          ),
                          title: 'AI auto-fix engine',
                        ),
                      ),
                      if (state.liveConnected)
                        const _MicroChip(
                            label: 'Live',
                            color: AppTheme.success,
                            icon: Icons.circle),
                      const SizedBox(width: 6),
                      const _MicroChip(
                          label: 'Claude vision', color: AppTheme.primary),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Claude publishes inspections & git patches through the '
                    'desktop hub; pull them here, review the heatmap, and '
                    'apply the patch with one copy.',
                    style: AppTheme.typeBodyMedium
                        .copyWith(color: AppTheme.darkTextDim),
                  ),
                  const SizedBox(height: 14),
                  GradientActionButton(
                    icon: Icons.sync_rounded,
                    label: 'Fetch latest diagnosis',
                    onTap: () => context
                        .read<ScreenCaptureBloc>()
                        .add(FetchDiagnosisEvent()),
                  ),
                ],
              ),
            ).animate().fadeIn(duration: 240.ms),
            const SizedBox(height: 14),
            if (framePath == null)
              const _EmptyDiagnose(
                  message: 'Capture a frame first to overlay heatmaps.')
            else
              HeatmapPanel(framePath: framePath, regions: state.bugRegions),
            const SizedBox(height: 14),
            if (state.bugRegions.isEmpty && patchText == null)
              const _EmptyDiagnose(
                  message: 'No published inspections yet. Ask Claude to call '
                      'publish_inspection / publish_patch on the MCP server.'),
            if (patchText != null) ...[
              PatchPanel(patch: state.patch!),
            ],
          ],
        );
      },
    );
  }
}

class HeatmapPanel extends StatelessWidget {
  const HeatmapPanel({super.key, required this.framePath, required this.regions});

  final String framePath;
  final List<BugRegion> regions;

  @override
  Widget build(BuildContext context) {
    final aspect = _aspectFor(context);
    return GlassPanel(
      borderColor: regions.isEmpty ? null : AppTheme.warning,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: SectionHeader(
                  icon: Icons.local_fire_department_rounded,
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFFDC2626), Color(0xFFF05252)],
                  ),
                  title: 'Visual diff heatmap',
                ),
              ),
              _MicroChip(
                  label: '${regions.length} finding(s)',
                  color: regions.isEmpty ? AppTheme.success : AppTheme.warning),
            ],
          ),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(AppTheme.radiusM),
            child: AspectRatio(
              aspectRatio: aspect,
              child: LayoutBuilder(
                builder: (context, constraints) => Stack(
                  fit: StackFit.expand,
                  children: [
                    Image.file(File(framePath),
                        fit: BoxFit.fill,
                        errorBuilder: (_, __, ___) => Container(
                              color: Theme.of(context).dividerColor,
                              child: Icon(Icons.broken_image_outlined,
                                  color: dimColor(context)),
                            )),
                    for (final region in regions)
                      Positioned(
                        left: region.x * constraints.maxWidth,
                        top: region.y * constraints.maxHeight,
                        width: region.w * constraints.maxWidth,
                        height: region.h * constraints.maxHeight,
                        child: Container(
                          decoration: BoxDecoration(
                            border: Border.all(color: region.color, width: 2.5),
                            borderRadius: BorderRadius.circular(8),
                            color: region.color.withValues(alpha: 0.14),
                          ),
                          child: region.label.length > 40
                              ? null
                              : Center(
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 5, vertical: 2),
                                    color: region.color.withValues(alpha: 0.85),
                                    child: Text(
                                      region.label,
                                      style: const TextStyle(
                                          color: Colors.white, fontSize: 9),
                                    ),
                                  ),
                                ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
          if (regions.isNotEmpty) ...[
            const SizedBox(height: 12),
            for (final region in regions)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      region.severity == BugSeverity.error
                          ? Icons.error_outline_rounded
                          : Icons.warning_amber_rounded,
                      size: 16,
                      color: region.color,
                    ),
                    const SizedBox(width: 8),
                    Expanded(child: Text(region.label)),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }

  double _aspectFor(BuildContext context) {
    final state = context.read<ScreenCaptureBloc>().state;
    final first = state.gallery.isEmpty ? null : state.gallery.first;
    if (first != null && first.width > 0 && first.height > 0) {
      return first.width / first.height;
    }
    return 0.4625;
  }
}

class PatchPanel extends StatelessWidget {
  const PatchPanel({super.key, required this.patch});

  final Map<String, dynamic> patch;

  @override
  Widget build(BuildContext context) {
    final patchText = patch['patch'] as String? ?? '';
    final description = patch['description'] as String? ?? 'Claude fix';
    final files = (patch['filesTouched'] as List<dynamic>? ?? const [])
        .whereType<String>()
        .toList();
    const command =
        'Save clipboard → patch.diff, then run:\ngit apply patch.diff';
    return GlassPanel(
      borderColor: AppTheme.success.withValues(alpha: 0.4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Expanded(
                child: SectionHeader(
                  icon: Icons.merge_type_rounded,
                  gradient: AppTheme.gradGreen,
                  title: 'Proposed git patch',
                ),
              ),
              _MicroChip(
                  label: 'ready',
                  color: AppTheme.success,
                  icon: Icons.check_rounded),
            ],
          ),
          const SizedBox(height: 8),
          Text(description,
              style: AppTheme.typeBody.copyWith(
                  color: Theme.of(context).brightness == Brightness.dark
                      ? const Color(0xFFF2EEFB)
                      : const Color(0xFF221A38))),
          if (files.isNotEmpty) ...[
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                for (final f in files)
                  _MicroChip(label: f, color: AppTheme.primary),
              ],
            ),
          ],
          const SizedBox(height: 12),
          GradientActionButton(
            icon: Icons.copy_rounded,
            label: 'Copy Git Patch',
            gradient: AppTheme.gradGreen,
            enabled: patchText.isNotEmpty,
            onTap: () {
              Clipboard.setData(ClipboardData(text: patchText));
              HapticFeedback.mediumImpact();
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                    content: Text('Patch copied — paste into patch.diff')),
              );
            },
          ),
          const SizedBox(height: 12),
          const CodePanel(title: 'Apply from terminal', code: command),
          const SizedBox(height: 8),
          CodePanel(
              title: 'Unified diff',
              code: patchText.length > 1600
                  ? '${patchText.substring(0, 1600)}\n… (truncated, copy for full patch)'
                  : patchText),
        ],
      ),
    ).animate().fadeIn(duration: 240.ms).slideY(begin: 0.03, end: 0);
  }
}

class _MicroChip extends StatelessWidget {
  const _MicroChip({required this.label, required this.color, this.icon});
  final String label;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 9, color: color),
            const SizedBox(width: 4),
          ],
          Text(label, style: AppTheme.microLabel.copyWith(color: color)),
        ],
      ),
    );
  }
}

class _EmptyDiagnose extends StatelessWidget {
  const _EmptyDiagnose({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      child: Column(
        children: [
          const GlossyTile(
              icon: Icons.visibility_rounded, size: 52, iconSize: 22),
          const SizedBox(height: 10),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontFamily: 'serif',
              fontStyle: FontStyle.italic,
              fontSize: 12.5,
              color: AppTheme.darkTextDim,
            ),
          ),
        ],
      ),
    );
  }
}
