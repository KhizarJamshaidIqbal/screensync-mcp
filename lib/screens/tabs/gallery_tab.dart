import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../models/frame_entry.dart';
import '../../services/device_intent_service.dart';
import '../../widgets/ref_widgets.dart';
import '../annotate_screen.dart';
import '../dashboard/detail_cards.dart';
import '../diff_screen.dart';

enum _GalleryFilter { all, synced, pending }

class GalleryTab extends StatefulWidget {
  const GalleryTab({super.key});

  @override
  State<GalleryTab> createState() => _GalleryTabState();
}

class _GalleryTabState extends State<GalleryTab> {
  _GalleryFilter _filter = _GalleryFilter.all;
  bool _newestFirst = true;
  bool _selectionMode = false;
  final Set<int> _selectedIds = {};

  List<FrameEntry> _visible(List<FrameEntry> all) {
    var list = all.where((e) {
      switch (_filter) {
        case _GalleryFilter.synced:
          return e.syncedHub;
        case _GalleryFilter.pending:
          return !e.syncedHub;
        default:
          return true;
      }
    }).toList();
    list.sort((a, b) => _newestFirst
        ? b.capturedAt.compareTo(a.capturedAt)
        : a.capturedAt.compareTo(b.capturedAt));
    return list;
  }

  void _openDiff(List<FrameEntry> all) {
    final picked = all.where((e) => _selectedIds.contains(e.id)).toList()
      ..sort((a, b) => a.capturedAt.compareTo(b.capturedAt));
    if (picked.length != 2) return;
    setState(() {
      _selectionMode = false;
      _selectedIds.clear();
    });
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => DiffScreen(before: picked.first, after: picked.last),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ScreenCaptureBloc, ScreenCaptureState>(
      builder: (context, state) {
        final visible = _visible(state.gallery);
        return RefreshIndicator(
          color: AppTheme.primary,
          onRefresh: () async => context
              .read<ScreenCaptureBloc>()
              .add(LoadGalleryEvent()),
          child: CustomScrollView(
            slivers: [
              SliverPadding(
                padding: const EdgeInsets.all(20),
                sliver: SliverList(
                  delegate: SliverChildListDelegate([
                    GlassPanel(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Expanded(
                                child: SectionHeader(
                                  icon: Icons.photo_library_rounded,
                                  gradient: AppTheme.gradPrimary,
                                  title: 'Gallery',
                                ),
                              ),
                              _StatusChip(
                                label: state.unsyncedCount > 0
                                    ? '${state.unsyncedCount} pending'
                                    : 'all synced',
                                color: state.unsyncedCount > 0
                                    ? AppTheme.warning
                                    : AppTheme.success,
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Every capture is cached on-device first, then '
                            'delivered to the hub. Pull to refresh.',
                            style: AppTheme.typeBodyMedium
                                .copyWith(color: AppTheme.darkTextDim),
                          ),
                          const SizedBox(height: 14),
                          Row(
                            children: [
                              Expanded(
                                child: PillSelector<_GalleryFilter>(
                                  options: const [
                                    PillOption(_GalleryFilter.all,
                                        Icons.apps_rounded, 'All'),
                                    PillOption(_GalleryFilter.synced,
                                        Icons.cloud_done_rounded, 'Synced'),
                                    PillOption(_GalleryFilter.pending,
                                        Icons.schedule_rounded, 'Pending'),
                                  ],
                                  selected: _filter,
                                  onSelect: (f) => setState(() => _filter = f),
                                ),
                              ),
                              const SizedBox(width: 8),
                              _RoundIconButton(
                                icon: _newestFirst
                                    ? Icons.arrow_downward_rounded
                                    : Icons.arrow_upward_rounded,
                                tooltip: _newestFirst
                                    ? 'Newest first'
                                    : 'Oldest first',
                                onTap: () => setState(
                                    () => _newestFirst = !_newestFirst),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          Row(
                            children: [
                              Expanded(
                                child: _GradientButton(
                                  icon: Icons.cloud_upload_rounded,
                                  label: 'Sync pending',
                                  onTap: () => context
                                      .read<ScreenCaptureBloc>()
                                      .add(SyncPendingEvent()),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: _OutlineButton(
                                  icon: _selectionMode
                                      ? Icons.close_rounded
                                      : Icons.checklist_rounded,
                                  label:
                                      _selectionMode ? 'Cancel' : 'Select',
                                  onTap: () => setState(() {
                                    _selectionMode = !_selectionMode;
                                    _selectedIds.clear();
                                  }),
                                ),
                              ),
                            ],
                          ),
                          if (_selectionMode) ...[
                            const SizedBox(height: 10),
                            _GradientButton(
                              icon: Icons.compare_arrows_rounded,
                              label: _selectedIds.length == 2
                                  ? 'Compare before/after'
                                  : 'Pick 2 frames (${_selectedIds.length}/2)',
                              enabled: _selectedIds.length == 2,
                              onTap: () => _openDiff(state.gallery),
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: 16),
                    if (state.gallery.isEmpty)
                      _EmptyGallery(
                        onStart: () => context
                            .read<ScreenCaptureBloc>()
                            .add(StartOverlayServiceEvent()),
                      )
                    else if (visible.isEmpty)
                      const _EmptyGallery(message: 'No frames in this view.'),
                  ]),
                ),
              ),
              if (visible.isNotEmpty)
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
                  sliver: SliverGrid.builder(
                    gridDelegate:
                        const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 3,
                      crossAxisSpacing: 12,
                      mainAxisSpacing: 12,
                    ),
                    itemCount: visible.length,
                    itemBuilder: (context, index) {
                      final entry = visible[index];
                      return GalleryTile(
                        entry: entry,
                        selectionMode: _selectionMode,
                        selected: _selectedIds.contains(entry.id),
                        onSelect: () => setState(() {
                          if (!_selectedIds.remove(entry.id)) {
                            _selectedIds.add(entry.id);
                          }
                        }),
                      );
                    },
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label, required this.color});
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(label,
          style: AppTheme.microLabel.copyWith(color: color)),
    );
  }
}

class _RoundIconButton extends StatelessWidget {
  const _RoundIconButton(
      {required this.icon, required this.tooltip, required this.onTap});
  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: dark ? AppTheme.darkSurfaceAlt : AppTheme.lightSurfaceAlt,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
                color: dark ? AppTheme.darkBorder : AppTheme.lightBorder),
          ),
          child: Icon(icon, size: 17, color: AppTheme.primary),
        ),
      ),
    );
  }
}

class _GradientButton extends StatelessWidget {
  const _GradientButton(
      {required this.icon, required this.label, required this.onTap,
      this.enabled = true});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: enabled ? 1 : 0.45,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: AppTheme.gradPrimary,
          borderRadius: BorderRadius.circular(AppTheme.radiusM),
          boxShadow: enabled
              ? [
                  BoxShadow(
                    color: AppTheme.primary.withValues(alpha: 0.4),
                    blurRadius: 12,
                    offset: const Offset(0, 5),
                  ),
                ]
              : null,
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(AppTheme.radiusM),
            onTap: enabled ? onTap : null,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(icon, size: 16, color: Colors.white),
                  const SizedBox(width: 7),
                  Flexible(
                    child: Text(label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 12.5,
                            fontWeight: FontWeight.w700)),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _OutlineButton extends StatelessWidget {
  const _OutlineButton(
      {required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(AppTheme.radiusM),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppTheme.radiusM),
            border: Border.all(
                color: AppTheme.primary.withValues(alpha: 0.4)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 16, color: AppTheme.primary),
              const SizedBox(width: 7),
              Text(label,
                  style: const TextStyle(
                      color: AppTheme.primary,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700)),
            ],
          ),
        ),
      ),
    );
  }
}

class _EmptyGallery extends StatelessWidget {
  const _EmptyGallery({this.onStart, this.message});
  final VoidCallback? onStart;
  final String? message;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const GlossyTile(
            icon: Icons.photo_camera_rounded, size: 64, iconSize: 26),
        const SizedBox(height: 12),
        Text(
          message ?? 'No captures yet.',
          style: const TextStyle(
            fontFamily: 'serif',
            fontStyle: FontStyle.italic,
            fontSize: 13,
            color: AppTheme.darkTextDim,
          ),
        ),
        if (onStart != null) ...[
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: _GradientButton(
              icon: Icons.play_arrow_rounded,
              label: 'Start Floating Bubble',
              onTap: onStart!,
            ),
          ),
        ],
      ],
    );
  }
}

class GalleryTile extends StatelessWidget {
  const GalleryTile({
    super.key,
    required this.entry,
    this.selectionMode = false,
    this.selected = false,
    this.onSelect,
  });

  final FrameEntry entry;
  final bool selectionMode;
  final bool selected;
  final VoidCallback? onSelect;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(AppTheme.radiusM),
        onTap: selectionMode ? onSelect : () => _openViewer(context),
        onLongPress: () => DeviceIntentService.shareImage(entry.filePath),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppTheme.radiusM),
            border: Border.all(
              color: selected
                  ? AppTheme.primary
                  : Colors.transparent,
              width: 2.5,
            ),
            boxShadow: selected
                ? [
                    BoxShadow(
                      color: AppTheme.primary.withValues(alpha: 0.45),
                      blurRadius: 12,
                      offset: const Offset(0, 4),
                    ),
                  ]
                : null,
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppTheme.radiusM - 2),
            child: Stack(
              fit: StackFit.expand,
              children: [
                Image.file(File(entry.thumbPath),
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => Container(
                          color: AppTheme.darkSurfaceAlt,
                          child: const Icon(Icons.broken_image_outlined,
                              size: 18, color: AppTheme.darkTextDim),
                        )),
                // Bottom gradient scrim with size micro-label.
                Positioned(
                  bottom: 0,
                  left: 0,
                  right: 0,
                  child: Container(
                    padding: const EdgeInsets.fromLTRB(7, 14, 7, 5),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          Colors.black.withValues(alpha: 0),
                          Colors.black.withValues(alpha: 0.72),
                        ],
                      ),
                    ),
                    child: Text(
                      entry.sizeLabel,
                      style: AppTheme.microLabel
                          .copyWith(color: Colors.white70),
                    ),
                  ),
                ),
                if (selectionMode)
                  Positioned(
                    top: 5,
                    right: 5,
                    child: Container(
                      width: 22,
                      height: 22,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: selected
                            ? AppTheme.primary
                            : Colors.black.withValues(alpha: 0.45),
                        border: Border.all(
                            color: Colors.white.withValues(alpha: 0.8),
                            width: 1.5),
                      ),
                      child: Icon(
                          selected
                              ? Icons.check_rounded
                              : Icons.add_rounded,
                          size: 13,
                          color: Colors.white),
                    ),
                  ),
                if (!selectionMode)
                  Positioned(
                    top: 5,
                    left: 5,
                    child: Row(
                      children: [
                        _SyncDot(ok: entry.syncedHub),
                        const SizedBox(width: 3),
                        _SyncDot(ok: entry.syncedDrive, green: true),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _openViewer(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => _FrameViewer(entry: entry)),
    );
  }
}

class _SyncDot extends StatelessWidget {
  const _SyncDot({required this.ok, this.green = false});
  final bool ok;
  final bool green;

  @override
  Widget build(BuildContext context) {
    final color = green ? AppTheme.success : AppTheme.primary;
    return Container(
      width: 9,
      height: 9,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: ok ? color : Colors.black.withValues(alpha: 0.4),
        border: Border.all(color: Colors.white.withValues(alpha: 0.85),
            width: 1.2),
        boxShadow: ok
            ? [
                BoxShadow(
                    color: color.withValues(alpha: 0.7),
                    blurRadius: 5,
                    spreadRadius: 0.5),
              ]
            : null,
      ),
    );
  }
}

/// Full-screen frame viewer: pinch-zoom, micro-chip meta bar, new actions.
class _FrameViewer extends StatelessWidget {
  const _FrameViewer({required this.entry});
  final FrameEntry entry;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF120B22),
      appBar: AppBar(
        backgroundColor: const Color(0xFF120B22),
        foregroundColor: const Color(0xFFF2EEFB),
        title: Text(entry.filename,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          onPressed: () => Navigator.of(context).pop(),
        ),
        actions: [
          IconButton(
            tooltip: 'Annotate / redact',
            icon: const Icon(Icons.draw_rounded, color: AppTheme.secondary),
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => AnnotateScreen(imagePath: entry.filePath))),
          ),
          IconButton(
            tooltip: 'Share',
            icon: const Icon(Icons.share_rounded),
            onPressed: () => DeviceIntentService.shareImage(entry.filePath),
          ),
          IconButton(
            tooltip: 'Copy path',
            icon: const Icon(Icons.content_copy_rounded),
            onPressed: () {
              Clipboard.setData(ClipboardData(text: entry.filePath));
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                  content: Text('Path copied.')));
            },
          ),
          IconButton(
            tooltip: 'Delete',
            icon: const Icon(Icons.delete_rounded, color: AppTheme.danger),
            onPressed: () {
              Navigator.of(context).pop();
              context.read<ScreenCaptureBloc>().add(DeleteFrameEvent(entry));
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                  content: Text('Frame deleted from this device.')));
            },
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: InteractiveViewer(
              minScale: 0.5,
              maxScale: 6,
              child: Center(
                child: Image.file(File(entry.filePath),
                    fit: BoxFit.contain,
                    errorBuilder: (_, __, ___) => const Center(
                        child: Text('File missing',
                            style: TextStyle(color: Colors.white70)))),
              ),
            ),
          ),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
            decoration: const BoxDecoration(
              color: Color(0xFF1B1230),
              border: Border(
                  top: BorderSide(color: Color(0xFF362A54))),
            ),
            child: SafeArea(
              top: false,
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                alignment: WrapAlignment.spaceBetween,
                children: [
                  _MetaChip(
                      icon: Icons.schedule_rounded,
                      label: entry.capturedAt
                          .toLocal()
                          .toString()
                          .split('.').first),
                  _MetaChip(icon: Icons.sd_card_rounded,
                      label: entry.sizeLabel),
                  _MetaChip(icon: Icons.aspect_ratio_rounded,
                      label: '${entry.width}×${entry.height}'),
                  _MetaChip(
                      icon: entry.syncedHub
                          ? Icons.cloud_done_rounded
                          : Icons.cloud_off_rounded,
                      label: entry.syncedHub ? 'synced' : 'pending',
                      accent: entry.syncedHub
                          ? AppTheme.success
                          : AppTheme.warning),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MetaChip extends StatelessWidget {
  const _MetaChip(
      {required this.icon, required this.label, this.accent});
  final IconData icon;
  final String label;
  final Color? accent;

  @override
  Widget build(BuildContext context) {
    final color = accent ?? AppTheme.secondary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: color),
          const SizedBox(width: 5),
          Text(label,
              style: AppTheme.microLabel.copyWith(
                  color: const Color(0xFFD9D3EE))),
        ],
      ),
    );
  }
}
