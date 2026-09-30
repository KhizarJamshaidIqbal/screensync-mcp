import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../services/device_intent_service.dart';
import '../../services/settings_service.dart';
import '../../widgets/ref_widgets.dart';
import '../dashboard/detail_cards.dart';
import '../settings/hub_connection_section.dart';
import '../settings/settings_cards_mixin.dart';
import '../settings/settings_rows.dart';
import '../settings/update_section.dart';

class SettingsTab extends StatefulWidget {
  const SettingsTab({super.key});

  @override
  State<SettingsTab> createState() => _SettingsTabState();
}

class _SettingsTabState extends State<SettingsTab>
    with SettingsCardsMixin<SettingsTab> {
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

        const UpdateSection(),
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
        privacyCard(settings),
        const SizedBox(height: 14),
        presetsCard(settings),
        const SizedBox(height: 14),
        regionFavoritesCard(settings),
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
              DriveRow(label: 'App folder', value: '/ScreenSync_MCP/'),
              DriveRow(
                  label: 'OAuth scope', value: 'drive.file (restricted)'),
              DriveRow(
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
