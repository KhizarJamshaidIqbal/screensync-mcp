import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../blocs/screen_capture_bloc.dart';
import '../services/app_update_service.dart';
import '../services/settings_service.dart';

/// Blocks the app until a published update is installed.
///
/// Wraps the whole app (main.dart's MaterialApp builder) so it covers every
/// screen, including onboarding, and cannot be navigated away from: the dialog
/// uses a non-tappable barrier plus a PopScope that refuses the back button, so
/// the only way out is installing - which is what was asked for.
///
/// Deliberately skipped when Google Play owns the install: Play policy forbids
/// installing a self-downloaded APK over a Play build, and the signing keys
/// differ anyway, so those devices must update through Play instead.
class AppUpdateGate extends StatefulWidget {
  const AppUpdateGate({super.key, required this.child});

  final Widget child;

  @override
  State<AppUpdateGate> createState() => _AppUpdateGateState();
}

class _AppUpdateGateState extends State<AppUpdateGate> {
  AppUpdateInfo? _pending;
  bool _checking = false;
  String? _status;
  bool _installing = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _check());
  }

  Future<void> _check() async {
    if (_checking || !mounted) return;
    _checking = true;
    try {
      final bloc = context.read<ScreenCaptureBloc>();
      final info = await AppUpdateService.instance.check(
        hubUrl: bloc.screenRepository.hubUrl,
        token: SettingsService.instance.pairingToken,
      );
      if (!mounted) return;
      if (info != null && info.updateAvailable) {
        setState(() => _pending = info);
        await _show();
      }
    } finally {
      _checking = false;
    }
  }

  Future<void> _show() async {
    final info = _pending;
    if (info == null || !mounted) return;
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => PopScope(
        canPop: false,
        child: StatefulBuilder(
          builder: (context, setLocal) => AlertDialog(
            title: Text('Update required: ${info.versionName}'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  'ScreenSync ${info.versionName} is published and this build '
                  '(${info.versionCode - 1}) is out of date. Install it to '
                  'continue.',
                ),
                const SizedBox(height: 10),
                Text(
                  'SHA-256 ${info.sha256.substring(0, 16)}...',
                  style: const TextStyle(fontSize: 11),
                ),
                if (_status != null) ...<Widget>[
                  const SizedBox(height: 10),
                  Text(_status!, style: const TextStyle(fontSize: 12)),
                ],
              ],
            ),
            actions: <Widget>[
              FilledButton.icon(
                onPressed: _installing
                    ? null
                    : () async {
                        setLocal(() => _installing = true);
                        setState(() => _status = 'Downloading...');
                        final line = await AppUpdateService.instance
                            .downloadAndInstall(info);
                        if (!mounted) return;
                        setState(() {
                          _status = line;
                          _installing = false;
                        });
                        setLocal(() {});
                      },
                icon: const Icon(Icons.download_rounded, size: 18),
                label: Text(_installing ? 'Working...' : 'Update now'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Re-offer the gate whenever the app is resumed, so a user cannot dodge it
    // by backgrounding the app instead of updating.
    return _UpdateResumeWatcher(
      onResume: () {
        if (_pending != null && mounted) {
          unawaited(_show());
        } else {
          unawaited(_check());
        }
      },
      child: widget.child,
    );
  }
}

/// Tiny lifecycle wrapper: calls [onResume] when the app comes back to front.
class _UpdateResumeWatcher extends StatefulWidget {
  const _UpdateResumeWatcher({required this.child, required this.onResume});

  final Widget child;
  final VoidCallback onResume;

  @override
  State<_UpdateResumeWatcher> createState() => _UpdateResumeWatcherState();
}

class _UpdateResumeWatcherState extends State<_UpdateResumeWatcher>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) widget.onResume();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
