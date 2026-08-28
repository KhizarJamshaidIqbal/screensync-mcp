import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../models/capture_quality.dart';
import '../../repositories/sync_mode.dart';
import '../../services/settings_service.dart';
import '../../widgets/common_widgets.dart';
import '../../widgets/connection_hero/connection_hero.dart';
import '../../widgets/permission_checklist.dart';
import '../../widgets/connect_kit_card.dart';
import '../../widgets/ref_widgets.dart';
import '../dashboard/bubble_status_card.dart';
import '../dashboard/capture_controls_card.dart';
import '../dashboard/detail_cards.dart';
import '../dashboard/stored_frames_section.dart';

class DashboardTab extends StatefulWidget {
  const DashboardTab({super.key, this.onQuality});

  final VoidCallback? onQuality;

  static bool isLoopbackDefault(String hubUrl) {
    return hubUrl.isEmpty ||
        hubUrl.contains('127.0.0.1') ||
        hubUrl.contains('localhost');
  }

  @override
  State<DashboardTab> createState() => _DashboardTabState();
}

class _DashboardTabState extends State<DashboardTab> {
  bool _showDetails = false;
  int _frameCount = 4;
  final ScrollController _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scroll.removeListener(_onScroll);
    _scroll.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scroll.position.pixels >= _scroll.position.maxScrollExtent - 240) {
      setState(() => _frameCount += 4);
    }
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ScreenCaptureBloc, ScreenCaptureState>(
      builder: (context, state) {
        final online = state.hubOnline == true;
        final checking = state.hubOnline == null || state.discovering;
        final showLoopbackWarning =
            DashboardTab.isLoopbackDefault(state.hubUrl) &&
                state.hubOnline == false;
        final simple = SettingsService.instance.simpleMode;
        return ListView(
          controller: _scroll,
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: StatusDotPill(
                label: online
                    ? 'Connected · ${state.hubLatencyMs ?? '—'}ms'
                    : (checking
                        ? 'Standing by · ${state.hubLatencyMs ?? '—'}ms'
                        : 'Hub offline'),
                color: online
                    ? AppTheme.success
                    : (checking ? AppTheme.primary : AppTheme.danger),
              ),
            ),
            const SizedBox(height: 16),
            const WatchHeading()
                .animate()
                .fadeIn(duration: 420.ms)
                .slideY(
                    begin: 0.06,
                    end: 0,
                    duration: 420.ms,
                    curve: Curves.easeOutCubic),
            const SizedBox(height: 20),
            const ConnectionHero()
                .animate(delay: 80.ms)
                .fadeIn(duration: 420.ms)
                .slideY(
                    begin: 0.06,
                    end: 0,
                    duration: 420.ms,
                    curve: Curves.easeOutCubic),
            const SizedBox(height: 14),
            BubbleStatusCard(running: state.isOverlayRunning)
                .animate(delay: 160.ms)
                .fadeIn(duration: 420.ms)
                .slideY(
                    begin: 0.06,
                    end: 0,
                    duration: 420.ms,
                    curve: Curves.easeOutCubic),
            const SizedBox(height: 14),
            const PermissionChecklist(),
            if (showLoopbackWarning && !simple) ...[
              const LoopbackWarningBanner(),
              const SizedBox(height: 14),
            ],
            const SectionHead(title: 'Configuration'),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: _ConfigCard(
                    icon: Icons.bolt_rounded,
                    label: 'Preset',
                    value: _presetLabel(state.quality),
                    sub: _presetSub(state.quality),
                    onTap: () =>
                        setState(() => _showDetails = !_showDetails),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _ConfigCard(
                    icon: Icons.merge_rounded,
                    label: 'Sync',
                    value: _syncLabel(state.syncMode),
                    sub: _syncSub(state.syncMode),
                    onTap: () =>
                        setState(() => _showDetails = !_showDetails),
                  ),
                ),
              ],
            )
                .animate(delay: 240.ms)
                .fadeIn(duration: 420.ms)
                .slideY(
                    begin: 0.06,
                    end: 0,
                    duration: 420.ms,
                    curve: Curves.easeOutCubic),
            AnimatedSize(
              duration: const Duration(milliseconds: 260),
              curve: Curves.easeInOut,
              alignment: Alignment.topCenter,
              child: _showDetails
                  ? Column(
                      children: [
                        const SizedBox(height: 12),
                        CaptureSyncCard(state: state),
                        const SizedBox(height: 14),
                        const CaptureControlsCard(),
                        if (!simple) ...[
                          const SizedBox(height: 14),
                          const ConnectKitCard(),
                        ],
                        const SizedBox(height: 14),
                        const DeviceStatusPanel(),
                      ],
                    )
                  : const SizedBox.shrink(),
            ),
            const SizedBox(height: 20),
            StoredFramesSection(
              frames: state.gallery,
              visibleCount: _frameCount,
              onLoadMore: () => setState(() => _frameCount += 4),
            ),
          ],
        );
      },
    );
  }

  String _presetLabel(CaptureQuality q) => switch (q) {
        CaptureQuality.stream => 'Stream',
        CaptureQuality.fast => 'Fast',
        CaptureQuality.inspection => 'Inspect',
      };

  String _presetSub(CaptureQuality q) => switch (q) {
        CaptureQuality.stream => '480p · <100ms',
        CaptureQuality.fast => '720p · <200ms',
        CaptureQuality.inspection => 'full PNG',
      };

  String _syncLabel(SyncMode m) => switch (m) {
        SyncMode.lanMdns => 'LAN',
        SyncMode.googleDrive => 'Drive',
        SyncMode.hybrid => 'Hybrid',
      };

  String _syncSub(SyncMode m) => switch (m) {
        SyncMode.lanMdns => 'mDNS first',
        SyncMode.googleDrive => 'BYOS',
        SyncMode.hybrid => 'LAN + Drive',
      };
}

/// Reference configuration card (PRESET / SYNC) with glossy tile + chevron.
class _ConfigCard extends StatelessWidget {
  const _ConfigCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.sub,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final String value;
  final String sub;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return GlassPanel(
      padding: const EdgeInsets.all(12),
      borderRadius: AppTheme.radiusM,
      child: InkWell(
        borderRadius: BorderRadius.circular(AppTheme.radiusM),
        onTap: onTap,
        child: Row(
          children: [
            GlossyTile(icon: icon, size: 36, iconSize: 17),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  MicroLabel(label),
                  const SizedBox(height: 2),
                  Text(
                    value,
                    style: AppTheme.typeTitleMedium.copyWith(
                        color: dark
                            ? const Color(0xFFF2EEFB)
                            : const Color(0xFF221A38)),
                  ),
                  Text(
                    sub,
                    style: AppTheme.typeCaption
                        .copyWith(color: AppTheme.darkTextDim),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded,
                size: 18, color: AppTheme.darkTextDim),
          ],
        ),
      ),
    );
  }
}
