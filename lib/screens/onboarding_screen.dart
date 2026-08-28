import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_overlay_window/flutter_overlay_window.dart';

import '../blocs/screen_capture_bloc.dart';
import '../core/app_theme.dart';
import '../services/device_intent_service.dart';
import '../services/pairing_service.dart';
import '../services/settings_service.dart';
import 'onboarding/connect_step.dart';
import 'onboarding/done_step.dart';
import 'onboarding/permissions_step.dart';
import 'onboarding/persona_step.dart';

/// First-run guided onboarding: persona → connect → permissions → done.
/// Replaces the "dropped into a technical dashboard" cold start.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, required this.onFinished});

  final VoidCallback onFinished;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _page = PageController();
  int _index = 0;

  bool? _devPersona; // null until chosen
  final _pairController = TextEditingController();
  String? _pairStatus;
  bool _pairOk = false;
  bool _overlayGranted = false;
  bool _notifGranted = false;

  @override
  void dispose() {
    _page.dispose();
    _pairController.dispose();
    super.dispose();
  }

  void _next() {
    if (_index >= 3) {
      _finish();
      return;
    }
    _page.nextPage(
        duration: const Duration(milliseconds: 320), curve: Curves.easeOutCubic);
  }

  void _finish() {
    SettingsService.instance
      ..simpleMode = !(_devPersona ?? true)
      ..onboardingDone = true;
    widget.onFinished();
  }

  Future<void> _applyPairingCode() async {
    final parsed = PairingService.parse(_pairController.text);
    if (parsed == null) {
      setState(() {
        _pairOk = false;
        _pairStatus =
            'Could not read that code. Paste the full screensync:// link or JSON from the desktop app.';
      });
      return;
    }
    final bloc = context.read<ScreenCaptureBloc>();
    bloc.add(SetPairingTokenEvent(parsed.token));
    bloc.add(SetHubUrlEvent(parsed.url));
    setState(() {
      _pairOk = true;
      _pairStatus = 'Paired with ${parsed.url} — checking connection…';
    });
  }

  Future<void> _refreshPermissions() async {
    final overlay = await FlutterOverlayWindow.isPermissionGranted();
    final notif = await DeviceIntentService.notificationsGranted();
    if (!mounted) return;
    setState(() {
      _overlayGranted = overlay;
      _notifGranted = notif;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            _progressHeader(),
            Expanded(
              child: PageView(
                controller: _page,
                physics: const NeverScrollableScrollPhysics(),
                onPageChanged: (i) {
                  setState(() => _index = i);
                  if (i == 2) _refreshPermissions();
                },
                children: [
                  PersonaStep(
                    devPersona: _devPersona,
                    onSelect: (dev) => setState(() => _devPersona = dev),
                    onNext: _next,
                  ),
                  ConnectStep(
                    pairController: _pairController,
                    pairStatus: _pairStatus,
                    pairOk: _pairOk,
                    onApplyPairing: _applyPairingCode,
                    onQrPaired: () => setState(() {
                      _pairOk = true;
                      _pairStatus = 'Paired via QR — checking connection…';
                    }),
                    onNext: _next,
                  ),
                  PermissionsStep(
                    overlayGranted: _overlayGranted,
                    notifGranted: _notifGranted,
                    onOverlayGrant: () async {
                      await FlutterOverlayWindow.requestPermission();
                      await _refreshPermissions();
                    },
                    onNotifGrant: () async {
                      await DeviceIntentService.requestPostNotifications();
                      await _refreshPermissions();
                    },
                    onNext: _next,
                  ),
                  DoneStep(
                    simpleMode: !(_devPersona ?? true),
                    onFinish: _finish,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _progressHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 18, 24, 8),
      child: Row(
        children: [
          for (var i = 0; i < 4; i++) ...[
            Expanded(
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 300),
                height: 5,
                decoration: BoxDecoration(
                  color: i <= _index
                      ? AppTheme.accentCyan
                      : Theme.of(context).dividerColor,
                  borderRadius: BorderRadius.circular(3),
                ),
              ),
            ),
            if (i < 3) const SizedBox(width: 6),
          ],
          const SizedBox(width: 14),
          TextButton(
            onPressed: _finish,
            child: const Text('Skip', style: TextStyle(fontSize: 13)),
          ),
        ],
      ),
    );
  }
}
