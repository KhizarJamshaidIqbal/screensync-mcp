import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../models/capture_quality.dart';
import '../../repositories/sync_mode.dart';
import '../../widgets/ref_widgets.dart';

/// Glossy-tile section header matching the reference cards.
class SectionHeader extends StatelessWidget {
  const SectionHeader(
      {super.key,
      required this.icon,
      this.color = AppTheme.primary,
      required this.title,
      this.gradient});
  final IconData icon;
  final Color color;
  final String title;
  final LinearGradient? gradient;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).brightness == Brightness.dark
        ? const Color(0xFFF2EEFB)
        : const Color(0xFF221A38);
    return Row(
      children: [
        gradient != null
            ? GlossyTile(icon: icon, gradient: gradient!, size: 34, iconSize: 16)
            : Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(icon, size: 16, color: color),
              ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(title,
              style: AppTheme.typeTitleLarge.copyWith(color: text)),
        ),
      ],
    );
  }
}

/// Rounded pill selector (replaces Material SegmentedButton — no overflow).
class PillSelector<T> extends StatelessWidget {
  const PillSelector({
    super.key,
    required this.options,
    required this.selected,
    required this.onSelect,
  });

  final List<PillOption<T>> options;
  final T selected;
  final ValueChanged<T> onSelect;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: dark ? AppTheme.darkSurfaceAlt : AppTheme.lightSurfaceAlt,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
            color: dark ? AppTheme.darkBorder : AppTheme.lightBorder),
      ),
      child: Row(
        children: [
          for (final option in options)
            Expanded(
              child: _Pill(
                option: option,
                selected: option.value == selected,
                onTap: () => onSelect(option.value),
              ),
            ),
        ],
      ),
    );
  }
}

class PillOption<T> {
  const PillOption(this.value, this.icon, this.label);
  final T value;
  final IconData icon;
  final String label;
}

class _Pill<T> extends StatelessWidget {
  const _Pill(
      {required this.option, required this.selected, required this.onTap});
  final PillOption<T> option;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        margin: const EdgeInsets.symmetric(horizontal: 2),
        padding: const EdgeInsets.symmetric(vertical: 9),
        decoration: BoxDecoration(
          gradient: selected ? AppTheme.gradPrimary : null,
          borderRadius: BorderRadius.circular(999),
          boxShadow: selected
              ? [
                  BoxShadow(
                    color: AppTheme.primary.withValues(alpha: 0.4),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ]
              : null,
        ),
        child: Center(
          child: FittedBox(
            fit: BoxFit.scaleDown,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(option.icon,
                    size: 14,
                    color: selected
                        ? Colors.white
                        : AppTheme.darkTextDim),
                const SizedBox(width: 5),
                Text(
                  option.label,
                  style: AppTheme.typeBodyMedium.copyWith(
                    fontWeight: FontWeight.w600,
                    color: selected ? Colors.white : AppTheme.darkTextDim,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Capture preset + sync mode card in the reference style.
class CaptureSyncCard extends StatelessWidget {
  const CaptureSyncCard({super.key, required this.state});
  final ScreenCaptureState state;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
              icon: Icons.speed_rounded,
              gradient: AppTheme.gradPrimary,
              title: 'Capture preset'),
          const SizedBox(height: 8),
          Text(
            'Stream = 480p JPEG (<100ms) · Fast = 720p JPEG (<200ms) · '
            'Inspection = full PNG for Claude precision analysis.',
            style:
                AppTheme.typeBodyMedium.copyWith(color: AppTheme.darkTextDim),
          ),
          const SizedBox(height: 12),
          PillSelector<CaptureQuality>(
            options: const [
              PillOption(
                  CaptureQuality.stream, Icons.rocket_launch_rounded, 'Stream'),
              PillOption(CaptureQuality.fast, Icons.bolt_rounded, 'Fast'),
              PillOption(
                  CaptureQuality.inspection, Icons.search_rounded, 'Inspect'),
            ],
            selected: state.quality,
            onSelect: (q) =>
                context.read<ScreenCaptureBloc>().add(SetQualityEvent(q)),
          ),
          const SizedBox(height: 18),
          const SectionHeader(
              icon: Icons.sync_rounded,
              gradient: AppTheme.gradGreen,
              title: 'Sync mode'),
          const SizedBox(height: 12),
          PillSelector<SyncMode>(
            options: const [
              PillOption(SyncMode.lanMdns, Icons.wifi_rounded, 'LAN'),
              PillOption(SyncMode.googleDrive, Icons.cloud_rounded, 'Drive'),
              PillOption(SyncMode.hybrid, Icons.merge_rounded, 'Hybrid'),
            ],
            selected: state.syncMode,
            onSelect: (m) =>
                context.read<ScreenCaptureBloc>().add(ToggleSyncModeEvent(m)),
          ),
        ],
      ),
    ).animate().fadeIn(duration: 240.ms);
  }
}

/// Micro-label left / semibold value right row.
class _MetaRow extends StatelessWidget {
  const _MetaRow({required this.label, this.value, this.chip});
  final String label;
  final String? value;
  final Widget? chip;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          MicroLabel(label),
          const Spacer(),
          if (chip != null)
            chip!
          else
            Flexible(
              child: Text(
                value ?? '—',
                textAlign: TextAlign.right,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTheme.typeBodyMedium.copyWith(
                  fontWeight: FontWeight.w600,
                  color: dark
                      ? const Color(0xFFF2EEFB)
                      : const Color(0xFF221A38),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ValueChip extends StatelessWidget {
  const _ValueChip({required this.label, required this.color, this.icon});
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
            Icon(icon, size: 11, color: color),
            const SizedBox(width: 4),
          ],
          Text(label,
              style: AppTheme.microLabel.copyWith(color: color)),
        ],
      ),
    );
  }
}

/// Recent-capture metadata card with hub re-check.
class RecentCaptureCard extends StatelessWidget {
  const RecentCaptureCard({super.key, required this.state});
  final ScreenCaptureState state;

  @override
  Widget build(BuildContext context) {
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: SectionHeader(
                    icon: Icons.history_rounded,
                    gradient: AppTheme.gradOrb,
                    title: 'Recent capture'),
              ),
              IconButton(
                tooltip: 'Re-check hub',
                icon: const Icon(Icons.refresh_rounded, size: 18),
                onPressed: () =>
                    context.read<ScreenCaptureBloc>().add(PingHubEvent()),
              ),
            ],
          ),
          const SizedBox(height: 6),
          _MetaRow(
              label: 'File',
              value: state.latestFrame?.filename ?? 'No capture yet'),
          _MetaRow(label: 'Size', value: state.latestFrame?.sizeLabel),
          _MetaRow(
              label: 'Time',
              value: state.latestFrame?.timestamp
                  .toLocal()
                  .toString()
                  .split('.').first),
          _MetaRow(label: 'Hub', value: state.hubUrl),
        ],
      ),
    ).animate().fadeIn(duration: 240.ms);
  }
}

/// Hub-side device connection status (fetched from /api/device/status).
class DeviceStatusPanel extends StatefulWidget {
  const DeviceStatusPanel({super.key});

  @override
  State<DeviceStatusPanel> createState() => _DeviceStatusPanelState();
}

class _DeviceStatusPanelState extends State<DeviceStatusPanel> {
  Map<String, dynamic>? _status;
  bool _loading = false;

  Future<void> _refresh() async {
    setState(() => _loading = true);
    final repo = context.read<ScreenCaptureBloc>().screenRepository;
    final result = await repo.fetchDeviceStatus();
    if (mounted) setState(() { _status = result; _loading = false; });
  }

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final s = _status;
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: SectionHeader(
                    icon: Icons.monitor_heart_rounded,
                    gradient: AppTheme.gradGreen,
                    title: 'Hub device status'),
              ),
              if (_loading)
                const SizedBox.square(
                    dimension: 14,
                    child: CircularProgressIndicator(strokeWidth: 2))
              else
                IconButton(
                  tooltip: 'Refresh',
                  icon: const Icon(Icons.refresh_rounded, size: 18),
                  onPressed: _refresh,
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),
            ],
          ),
          const SizedBox(height: 6),
          if (s == null)
            Text('Hub offline or not reachable.',
                style: AppTheme.typeBodyMedium
                    .copyWith(color: AppTheme.darkTextDim))
          else ...[
            _MetaRow(
              label: 'Connected',
              chip: s['connected'] == true
                  ? const _ValueChip(
                      label: 'Yes',
                      color: AppTheme.success,
                      icon: Icons.check_rounded)
                  : const _ValueChip(
                      label: 'No',
                      color: AppTheme.danger,
                      icon: Icons.close_rounded),
            ),
            _MetaRow(label: 'Transport', value: s['transport'] as String?),
            _MetaRow(label: 'Last frame', value: s['lastFrameAt'] as String?),
            _MetaRow(label: 'Device', value: s['deviceModel'] as String?),
            _MetaRow(value: '${s['retainedFrames'] ?? 0} / 20',
                label: 'Retained'),
          ],
        ],
      ),
    ).animate().fadeIn(duration: 240.ms);
  }
}
