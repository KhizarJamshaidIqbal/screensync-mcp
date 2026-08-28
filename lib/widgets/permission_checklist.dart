import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_overlay_window/flutter_overlay_window.dart';

import '../core/app_theme.dart';
import '../services/device_intent_service.dart';
import '../services/settings_service.dart';
import '../widgets/common_widgets.dart';
import '../widgets/ref_widgets.dart';
import '../screens/dashboard/detail_cards.dart';

/// Live onboarding checklist pinned to the top of the Dashboard. Each row is
/// a permission the user still needs to grant; as soon as one is granted the
/// row animates away, and when all are done the whole card collapses.
class PermissionChecklist extends StatefulWidget {
  const PermissionChecklist({super.key});

  @override
  State<PermissionChecklist> createState() => _PermissionChecklistState();
}

class _PermissionChecklistState extends State<PermissionChecklist>
    with WidgetsBindingObserver {
  Timer? _poll;
  bool _loading = true;
  bool _overlay = false;
  bool _battery = false;
  bool _notifications = false;
  bool _isOem = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
    // Poll so granting in system settings reflects here without a restart;
    // stops itself once everything is granted.
    _poll = Timer.periodic(const Duration(seconds: 3), (_) => _refresh());
  }

  @override
  void dispose() {
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    try {
      final overlay = await FlutterOverlayWindow.isPermissionGranted();
      final battery = await DeviceIntentService.batteryWhitelisted();
      final notifications = await DeviceIntentService.notificationsGranted();
      final brand = await DeviceIntentService.deviceBrand();
      if (!mounted) return;
      setState(() {
        _overlay = overlay;
        _battery = battery;
        _notifications = notifications;
        _isOem = brand != 'stock';
        _loading = false;
      });
      if (_allDone) _poll?.cancel();
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool get _vendorDone => !(_isOem) || SettingsService.instance.vendorConfirmed;

  /// Gesture control (ADB input injection) is a manual, undetectable grant —
  /// track via acknowledgement like the vendor step.
  bool get _gestureDone => SettingsService.instance.gestureControlConfirmed;

  bool get _allDone =>
      _overlay && _battery && _notifications && _vendorDone && _gestureDone;

  int get _grantedCount => [
        _overlay,
        _battery,
        _notifications,
        if (_isOem) _vendorDone,
        _gestureDone,
      ].where((e) => e).length;

  int get _totalCount => _isOem ? 5 : 4;

  @override
  Widget build(BuildContext context) {
    if (_loading) return const SizedBox.shrink();
    if (_allDone) {
      return const SizedBox.shrink()
          .animate()
          .fadeOut(duration: 400.ms);
    }
    final pending = _pendingItems();
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: GlassPanel(
      borderColor: AppTheme.warning.withValues(alpha: 0.5),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _header(context),
          const SizedBox(height: 14),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
              value: _grantedCount / _totalCount,
              minHeight: 6,
              backgroundColor: dimColor(context).withValues(alpha: 0.18),
              valueColor: const AlwaysStoppedAnimation(AppTheme.success),
            ),
          ),
          const SizedBox(height: 6),
          Text('$_grantedCount of $_totalCount granted',
              style: TextStyle(fontSize: 11, color: dimColor(context))),
          const SizedBox(height: 12),
          for (var i = 0; i < pending.length; i++)
            Padding(
              key: ValueKey(pending[i].key),
              padding: EdgeInsets.only(bottom: i == pending.length - 1 ? 0 : 12),
              child: _row(context, pending[i]),
            ).animate(key: ValueKey('anim-${pending[i].key}')).fadeIn(duration: 320.ms),
        ],
      ),
      ),
    );
  }

  Widget _header(BuildContext context) {
    return Row(
      children: [
        const Expanded(
          child: SectionHeader(
            icon: Icons.verified_user_rounded,
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFFD97706), Color(0xFFFBBF24)],
            ),
            title: 'Finish setup',
          ),
        ),
        MicroChip(
            label: '$_grantedCount/$_totalCount', color: AppTheme.warning),
      ],
    );
  }

  Widget _row(BuildContext context, _ChecklistItem item) {
    return Row(
      children: [
        Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(
            color: AppTheme.warning.withValues(alpha: 0.14),
            borderRadius: BorderRadius.circular(AppTheme.radiusM),
          ),
          child: Icon(item.icon, color: AppTheme.warning, size: 20),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(item.title,
                  style: const TextStyle(
                      fontWeight: FontWeight.w600, fontSize: 13.5)),
              const SizedBox(height: 2),
              Text(item.subtitle,
                  style:
                      TextStyle(fontSize: 11, color: dimColor(context))),
            ],
          ),
        ),
        const SizedBox(width: 8),
        InkWell(
          borderRadius: BorderRadius.circular(999),
          onTap: item.onAction,
          child: Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
            decoration: BoxDecoration(
              gradient: AppTheme.gradPrimary,
              borderRadius: BorderRadius.circular(999),
              boxShadow: [
                BoxShadow(
                  color: AppTheme.primary.withValues(alpha: 0.4),
                  blurRadius: 8,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: Text(
              item.actionLabel,
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 11,
                  fontWeight: FontWeight.w700),
            ),
          ),
        ),
      ],
    );
  }

  List<_ChecklistItem> _pendingItems() {
    return [
      if (!_overlay)
        _ChecklistItem(
          key: 'overlay',
          icon: Icons.picture_in_picture_alt_rounded,
          title: 'Display over other apps',
          subtitle: 'Lets the floating bubble sit above everything',
          actionLabel: 'Allow',
          onAction: () async {
            await FlutterOverlayWindow.requestPermission();
            _refresh();
          },
        ),
      if (!_notifications)
        _ChecklistItem(
          key: 'notif',
          icon: Icons.notifications_active_rounded,
          title: 'Notifications',
          subtitle: 'Keeps the capture service alive and visible',
          actionLabel: 'Allow',
          onAction: () async {
            await DeviceIntentService.requestPostNotifications();
            _refresh();
          },
        ),
      if (!_battery)
        _ChecklistItem(
          key: 'battery',
          icon: Icons.battery_saver_rounded,
          title: 'Ignore battery optimization',
          subtitle: 'Stops Android killing the bubble in background',
          actionLabel: 'Allow',
          onAction: () async {
            await DeviceIntentService.requestBatteryWhitelist();
            _refresh();
          },
        ),
      if (_isOem && !_vendorDone)
        _ChecklistItem(
          key: 'vendor',
          icon: Icons.smartphone_rounded,
          title: 'Vendor auto-start / background',
          subtitle: 'MIUI/Samsung kill overlays — enable in OEM settings',
          actionLabel: 'Open',
          onAction: () async {
            await DeviceIntentService.openVendorBackgroundSettings();
            if (!mounted) return;
            setState(() => SettingsService.instance.vendorConfirmed = true);
            _confirmHint();
          },
        ),
      if (!_gestureDone)
        _ChecklistItem(
          key: 'gesture',
          icon: Icons.touch_app_rounded,
          title: 'AI gesture control (USB debugging Security)',
          subtitle:
              'Turn ON "USB debugging (Security settings)" so your AI can '
              'tap, swipe & type — not just watch',
          actionLabel: 'Open',
          onAction: () async {
            await DeviceIntentService.openDeveloperSettings();
            if (!mounted) return;
            setState(
                () => SettingsService.instance.gestureControlConfirmed = true);
            _gestureHint();
          },
        ),
    ];
  }

  void _gestureHint() {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
      duration: Duration(seconds: 5),
      content: Text(
        'Enable "USB debugging (Security settings)" in Developer options, '
        'then your AI can control the screen. Marked as done.',
      ),
    ));
  }

  void _confirmHint() {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
      content: Text('Marked as done. Reopen from Settings any time.'),
    ));
  }
}

class _ChecklistItem {
  const _ChecklistItem({
    required this.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.actionLabel,
    required this.onAction,
  });
  final String key;
  final IconData icon;
  final String title;
  final String subtitle;
  final String actionLabel;
  final Future<void> Function() onAction;
}
