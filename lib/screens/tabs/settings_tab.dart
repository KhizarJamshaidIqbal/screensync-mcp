import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../models/custom_preset.dart';
import '../../models/region_favorite.dart';
import '../../services/device_intent_service.dart';
import '../../services/settings_service.dart';
import '../../widgets/common_widgets.dart';
import '../../widgets/ref_widgets.dart';
import '../dashboard/detail_cards.dart';
import '../settings/hub_connection_section.dart';

class SettingsTab extends StatefulWidget {
  const SettingsTab({super.key});

  @override
  State<SettingsTab> createState() => _SettingsTabState();
}

class _SettingsTabState extends State<SettingsTab> {
  final _hubUrlController = TextEditingController();
  final _tokenController = TextEditingController();
  String? _brand;
  bool _batteryOk = false;
  bool _brandLoading = true;

  @override
  void initState() {
    super.initState();
    final settings = SettingsService.instance;
    _hubUrlController.text = settings.hubUrlOverride;
    _tokenController.text = settings.pairingToken == 'screensync-local-dev'
        ? ''
        : settings.pairingToken;
    _loadDoctorState();
  }

  Future<void> _loadDoctorState() async {
    setState(() => _brandLoading = true);
    final brand = await DeviceIntentService.deviceBrand();
    final battery = await DeviceIntentService.batteryWhitelisted();
    if (!mounted) return;
    setState(() {
      _brand = brand;
      _batteryOk = battery;
      _brandLoading = false;
    });
  }

  @override
  void dispose() {
    _hubUrlController.dispose();
    _tokenController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final settings = SettingsService.instance;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        // -- Appearance -
        GlassPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SectionHeader(
                icon: Icons.palette_rounded,
                gradient: AppTheme.gradOrb,
                title: 'Appearance',
              ),
              const SizedBox(height: 12),
              PillSelector<ThemeMode>(
                options: const [
                  PillOption(ThemeMode.system, Icons.brightness_auto_rounded,
                      'Auto'),
                  PillOption(ThemeMode.light, Icons.light_mode_rounded,
                      'Light'),
                  PillOption(ThemeMode.dark, Icons.dark_mode_rounded, 'Dark'),
                ],
                selected: settings.themeMode,
                onSelect: (m) => setState(() => settings.themeMode = m),
              ),
              SwitchListTile(
                activeThumbColor: AppTheme.primary,
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: const Text('Simple mode',
                    style: TextStyle(fontSize: 13,
                        fontWeight: FontWeight.w600)),
                subtitle: Text(
                    'Hide developer surfaces (MCP, Diagnose, Telemetry). '
                    'Just capture and sync.',
                    style: AppTheme.typeBodyMedium
                        .copyWith(color: AppTheme.darkTextDim)),
                value: settings.simpleMode,
                onChanged: (v) => setState(() => settings.simpleMode = v),
              ),
            ],
          ),
        ).animate().fadeIn(duration: 240.ms),
        const SizedBox(height: 14),

        // -- Hub connection --
        HubConnectionSection(
          hubUrlController: _hubUrlController,
          tokenController: _tokenController,
        ),
        const SizedBox(height: 14),

        // -- Capture behaviour --
        GlassPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SectionHeader(
                icon: Icons.vibration_rounded,
                gradient: AppTheme.gradPrimary,
                title: 'Capture behaviour',
              ),
              SwitchListTile(
                activeThumbColor: AppTheme.primary,
                contentPadding: EdgeInsets.zero,
                title: const Text('Shake-to-capture',
                    style: TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w600)),
                subtitle: Text(
                    'A firm shake (= threshold m/s�) triggers an instant capture',
                    style: AppTheme.typeBodyMedium
                        .copyWith(color: AppTheme.darkTextDim)),
                value: settings.shakeEnabled,
                onChanged: (v) {
                  setState(() => settings.shakeEnabled = v);
                  context.read<ScreenCaptureBloc>().retuneShakeListener();
                },
              ),
              if (settings.shakeEnabled)
                Row(
                  children: [
                    Expanded(
                      child: Slider(
                        activeColor: AppTheme.primary,
                        value: settings.shakeThreshold,
                        min: 8,
                        max: 25,
                        divisions: 17,
                        label:
                            '${settings.shakeThreshold.toStringAsFixed(0)} m/s�',
                        onChanged: (v) =>
                            setState(() => settings.shakeThreshold = v),
                        onChangeEnd: (_) => context
                            .read<ScreenCaptureBloc>()
                            .retuneShakeListener(),
                      ),
                    ),
                    Text(
                        '${settings.shakeThreshold.toStringAsFixed(0)} m/s�',
                        style: const TextStyle(
                            fontSize: 12, fontFamily: 'monospace')),
                  ],
                ),
            ],
          ),
        ),
        const SizedBox(height: 14),

        // -- Privacy & capture power (C1/C2/C3) --
        _privacyCard(settings),
        const SizedBox(height: 14),
        _presetsCard(settings),
        const SizedBox(height: 14),
        _regionFavoritesCard(settings),
        const SizedBox(height: 14),

        // -- Permission doctor --
        GlassPanel(
          borderColor: (_batteryOk ? AppTheme.success : AppTheme.warning)
              .withValues(alpha: 0.4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Expanded(
                    child: SectionHeader(
                      icon: Icons.medical_services_rounded,
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [Color(0xFFD97706), Color(0xFFFBBF24)],
                      ),
                      title: 'Permission doctor',
                    ),
                  ),
                  if (_brandLoading)
                    const SizedBox.square(
                        dimension: 14,
                        child: CircularProgressIndicator(strokeWidth: 2))
                  else
                    MicroChip(
                        label: _brandLabel(_brand),
                        color: AppTheme.primary),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                'OEMs (MIUI/HyperOS, One UI�) kill overlays aggressively. '
                'Grant every item below, then pull-to-refresh this tab.',
                style: AppTheme.typeBodyMedium
                    .copyWith(color: AppTheme.darkTextDim),
              ),
              const SizedBox(height: 12),
              const DoctorTile(
                icon: Icons.picture_in_picture_alt_rounded,
                title: 'Display over other apps',
                trailing: Text('Open'),
                onTap: DeviceIntentService.openOverlaySettings,
              ),
              DoctorTile(
                icon: Icons.battery_saver_rounded,
                title: 'Ignore battery optimizations',
                trailing: Text(_batteryOk ? 'Granted' : 'Request'),
                tint: _batteryOk ? AppTheme.success : AppTheme.warning,
                onTap: () async {
                  await DeviceIntentService.requestBatteryWhitelist();
                  await _loadDoctorState();
                  return;
                },
              ),
              DoctorTile(
                icon: Icons.auto_fix_high_rounded,
                title: 'Vendor auto-start / background',
                subtitle: _brand == 'stock'
                    ? 'Stock Android � nothing extra needed'
                    : 'Opens the hidden OEM permissions page',
                trailing: const Text('Open'),
                onTap: _brand == 'stock'
                    ? null
                    : DeviceIntentService.openVendorBackgroundSettings,
              ),
              const DoctorTile(
                icon: Icons.notifications_active_rounded,
                title: 'Notifications (Android 13+)',
                subtitle: 'Keeps the capture service status visible',
                trailing: Text('Request'),
                onTap: DeviceIntentService.requestPostNotifications,
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),

        // -- Drive BYOS info --
        const GlassPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: SectionHeader(
                      icon: Icons.cloud_done_rounded,
                      gradient: AppTheme.gradGreen,
                      title: 'Google Drive BYOS',
                    ),
                  ),
                  MicroChip(
                      label: 'Private',
                      color: AppTheme.success,
                      icon: Icons.lock_rounded),
                ],
              ),
              SizedBox(height: 12),
              _DriveRow(label: 'App folder', value: '/ScreenSync_MCP/'),
              _DriveRow(
                  label: 'OAuth scope', value: 'drive.file (restricted)'),
              _DriveRow(
                  label: 'Retention',
                  value: '20 files on Drive � 60 on device'),
              SizedBox(height: 8),
              Text(
                'drive.file scope limits access to files this app created. '
                'Drive is used as the hybrid/offline fallback transport.',
                style: TextStyle(
                    color: AppTheme.darkTextDim, height: 1.45, fontSize: 12),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
      ],
    );
  }

  // ── C2: privacy redaction toggle ──
  Widget _privacyCard(SettingsService settings) {
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
            icon: Icons.privacy_tip_rounded,
            gradient: AppTheme.gradPrimary,
            title: 'Privacy redaction',
          ),
          SwitchListTile(
            activeThumbColor: AppTheme.primary,
            contentPadding: EdgeInsets.zero,
            title: const Text('Redact before sending',
                style:
                    TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
            subtitle: Text(
                'Pixelate every captured frame on-device before it is stored '
                'or uploaded to the hub / Drive.',
                style: AppTheme.typeBodyMedium
                    .copyWith(color: AppTheme.darkTextDim)),
            value: settings.redactionEnabled,
            onChanged: (v) => setState(() => settings.redactionEnabled = v),
          ),
        ],
      ),
    );
  }

  // ── C1: custom capture presets manager ──
  Widget _presetsCard(SettingsService settings) {
    final presets = CustomPreset.decodeList(settings.customPresetsRaw);
    final activeId = settings.activeCustomPresetId;
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: SectionHeader(
                  icon: Icons.tune_rounded,
                  gradient: AppTheme.gradPrimary,
                  title: 'Capture presets',
                ),
              ),
              IconButton(
                tooltip: 'Add preset',
                icon: const Icon(Icons.add_rounded),
                onPressed: () => _addPresetDialog(settings, presets),
              ),
            ],
          ),
          const SizedBox(height: 4),
          if (presets.isEmpty)
            Text('No custom presets yet. Tap + to add one.',
                style: AppTheme.typeBodyMedium
                    .copyWith(color: AppTheme.darkTextDim))
          else
            for (final p in presets)
              RadioListTile<String>(
                activeColor: AppTheme.primary,
                contentPadding: EdgeInsets.zero,
                dense: true,
                value: p.id,
                groupValue: activeId,
                onChanged: (v) =>
                    setState(() => settings.activeCustomPresetId = v ?? ''),
                title: Row(
                  children: [
                    Expanded(
                      child: Text(p.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              fontSize: 13, fontWeight: FontWeight.w600)),
                    ),
                    IconButton(
                      tooltip: 'Delete preset',
                      visualDensity: VisualDensity.compact,
                      icon: const Icon(Icons.delete_outline_rounded,
                          size: 18),
                      onPressed: () {
                        final next =
                            presets.where((e) => e.id != p.id).toList();
                        setState(() {
                          settings.customPresetsRaw =
                              CustomPreset.encodeList(next);
                          if (activeId == p.id) {
                            settings.activeCustomPresetId = '';
                          }
                        });
                      },
                    ),
                  ],
                ),
                subtitle: Text(p.summary,
                    style: AppTheme.typeCaption
                        .copyWith(color: AppTheme.darkTextDim)),
              ),
        ],
      ),
    );
  }

  Future<void> _addPresetDialog(
      SettingsService settings, List<CustomPreset> presets) async {
    final nameCtrl = TextEditingController();
    var width = 720;
    var jpeg = true;
    final result = await showDialog<CustomPreset>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('New preset'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: nameCtrl,
                  decoration: const InputDecoration(
                      labelText: 'Name', hintText: 'e.g. Docs scan'),
                ),
                const SizedBox(height: 12),
                const Text('Resolution (long edge)',
                    style: TextStyle(fontSize: 12)),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final w in const [0, 480, 720, 1080])
                      ChoiceChip(
                        label: Text(w == 0 ? 'Native' : '${w}px'),
                        selected: width == w,
                        onSelected: (_) => setLocal(() => width = w),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                const Text('Format', style: TextStyle(fontSize: 12)),
                Wrap(
                  spacing: 8,
                  children: [
                    ChoiceChip(
                      label: const Text('JPEG'),
                      selected: jpeg,
                      onSelected: (_) => setLocal(() => jpeg = true),
                    ),
                    ChoiceChip(
                      label: const Text('PNG'),
                      selected: !jpeg,
                      onSelected: (_) => setLocal(() => jpeg = false),
                    ),
                  ],
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancel')),
            FilledButton(
              onPressed: () {
                final name = nameCtrl.text.trim();
                if (name.isEmpty) return;
                Navigator.pop(
                  ctx,
                  CustomPreset(
                    id: DateTime.now().microsecondsSinceEpoch.toString(),
                    name: name,
                    maxWidth: width,
                    jpeg: jpeg,
                    jpegQuality: 74,
                  ),
                );
              },
              child: const Text('Add'),
            ),
          ],
        ),
      ),
    );
    if (result == null) return;
    final next = [...presets, result];
    setState(() {
      settings.customPresetsRaw = CustomPreset.encodeList(next);
      settings.activeCustomPresetId = result.id;
    });
  }

  // ── C3: region favorites list ──
  Widget _regionFavoritesCard(SettingsService settings) {
    final favs = RegionFavorite.decodeList(settings.regionFavoritesRaw);
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SectionHeader(
            icon: Icons.crop_rounded,
            gradient: AppTheme.gradGreen,
            title: 'Region favorites',
          ),
          const SizedBox(height: 4),
          if (favs.isEmpty)
            Text(
                'No saved regions yet. Save a crop from the region editor to '
                'reuse it here.',
                style: AppTheme.typeBodyMedium
                    .copyWith(color: AppTheme.darkTextDim))
          else
            for (final f in favs)
              ListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                leading: const Icon(Icons.crop_free_rounded,
                    color: AppTheme.primary),
                title: Text(f.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w600)),
                subtitle: Text(f.summary,
                    style: AppTheme.typeCaption
                        .copyWith(color: AppTheme.darkTextDim)),
                trailing: IconButton(
                  tooltip: 'Delete region',
                  icon: const Icon(Icons.delete_outline_rounded, size: 18),
                  onPressed: () {
                    final next =
                        favs.where((e) => e.name != f.name).toList();
                    setState(() => settings.regionFavoritesRaw =
                        RegionFavorite.encodeList(next));
                  },
                ),
              ),
        ],
      ),
    );
  }

  static String _brandLabel(String? brand) {
    return switch (brand) {
      'xiaomi' => 'Xiaomi � MIUI/HyperOS',
      'samsung' => 'Samsung � One UI',
      'huawei' => 'Huawei � EMUI',
      'oppo' => 'OPPO � ColorOS',
      'vivo' => 'vivo � Funtouch',
      _ => 'Stock Android',
    };
  }
}

class DoctorTile extends StatelessWidget {
  const DoctorTile({
    super.key,
    required this.icon,
    required this.title,
    required this.trailing,
    this.subtitle,
    this.tint,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final Widget trailing;
  final String? subtitle;
  final Color? tint;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final tint = this.tint ?? AppTheme.primary;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: tint.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, size: 17, color: tint),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w600)),
                if (subtitle != null)
                  Text(subtitle!,
                      style: AppTheme.typeBodyMedium
                          .copyWith(color: AppTheme.darkTextDim)),
              ],
            ),
          ),
          InkWell(
            borderRadius: BorderRadius.circular(999),
            onTap: onTap,
            child: Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: tint.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: tint.withValues(alpha: 0.35)),
              ),
              child: DefaultTextStyle(
                style: AppTheme.microLabel.copyWith(color: tint),
                child: trailing,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DriveRow extends StatelessWidget {
  const _DriveRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          MicroLabel(label),
          const Spacer(),
          Text(
            value,
            style: AppTheme.typeBodyMedium.copyWith(
              fontWeight: FontWeight.w600,
              color:
                  dark ? const Color(0xFFF2EEFB) : const Color(0xFF221A38),
            ),
          ),
        ],
      ),
    );
  }
}
