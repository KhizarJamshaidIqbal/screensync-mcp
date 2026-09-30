import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../blocs/screen_capture_bloc.dart';
import '../core/app_navigator.dart';
import '../services/app_update_service.dart';
import '../services/settings_service.dart';

/// Offers a published update and, for Play builds, blocks until it is installed.
///
/// Wraps the whole app (main.dart's MaterialApp builder), so it sits ABOVE the
/// Navigator: it has no Navigator ancestor and must reach it through
/// [appNavigatorKey] (`MaterialApp.navigatorKey`) to show its dialog. The dialog
/// has a non-tappable barrier and a PopScope that refuses the back button.
///
/// Which channel performs the install depends on who owns this build:
///   * Google Play owns it  -> Play's own immediate In-App Update flow, which is
///     full-screen and cannot be dismissed either, and is the only thing allowed
///     to replace a Play build (the signing keys differ). The dialog is
///     required: there is no way out except installing.
///   * sideloaded           -> download from the hub, verify it, hand the file to
///     the system installer. The dialog has a "Later" button that silences that
///     build for 24 hours.
///
/// Checks run on start and on every resume, unless the user switched automatic
/// update checks off in Settings.
class AppUpdateGate extends StatefulWidget {
  const AppUpdateGate({
    super.key,
    required this.child,
    this.service,
    this.hubUrlResolver,
  });

  final Widget child;

  /// Test seam: replaces [AppUpdateService.instance].
  @visibleForTesting
  final AppUpdateService? service;

  /// Test seam: replaces the hub URL read from the ScreenCaptureBloc.
  @visibleForTesting
  final String Function(BuildContext context)? hubUrlResolver;

  @override
  State<AppUpdateGate> createState() => _AppUpdateGateState();
}

/// How many frames to wait for the Navigator to exist before giving up.
const _navigatorAttempts = 120;

enum _GateResult { later }

class _AppUpdateGateState extends State<AppUpdateGate> {
  AppUpdateInfo? _pending;
  bool _checking = false;
  bool _dialogOpen = false;

  AppUpdateService get _service => widget.service ?? AppUpdateService.instance;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => unawaited(_check()));
  }

  String _hubUrl() => (widget.hubUrlResolver ?? _hubUrlFromBloc)(context);

  static String _hubUrlFromBloc(BuildContext context) =>
      context.read<ScreenCaptureBloc>().screenRepository.hubUrl;

  /// Asks the owning channel for an update and shows the dialog if one is
  /// newer. Never throws: an update check is a convenience, and a failure here
  /// must not surface as an unhandled async error on every app resume.
  Future<void> _check() async {
    if (_checking || _dialogOpen || !mounted) return;
    _checking = true;
    try {
      final service = _service;
      if (!await service.autoCheckEnabled() || !mounted) return;
      final info = await service.check(
        hubUrl: _hubUrl(),
        token: SettingsService.instance.pairingToken,
      );
      if (!mounted || info == null || !info.updateAvailable) return;
      if (!info.playManaged && await service.isDismissed(info.versionCode)) {
        return;
      }
      if (!mounted) return;
      _pending = info;
    } catch (e) {
      debugPrint('AppUpdateGate: update check failed (${e.runtimeType})');
      return;
    } finally {
      _checking = false;
    }
    await _show();
  }

  /// The Navigator's own context, once it exists. [appNavigatorKey] is empty
  /// until the first frame has built the Navigator, so wait for it frame by
  /// frame, for a bounded time.
  Future<BuildContext?> _navigatorContext() {
    final ready = Completer<BuildContext?>();
    var attempts = 0;
    void poll() {
      final navigator = appNavigatorKey.currentContext;
      if (navigator != null && navigator.mounted) {
        ready.complete(navigator);
      } else if (!mounted || ++attempts > _navigatorAttempts) {
        ready.complete(null);
      } else {
        WidgetsBinding.instance.addPostFrameCallback((_) => poll());
        WidgetsBinding.instance.scheduleFrame();
      }
    }

    poll();
    return ready.future;
  }

  /// Re-reads the manifest for the OPEN dialog. The dialog holds its own copy of
  /// the info, and nothing refreshes it while it is up: if the hub rebuilds the
  /// APK in the meantime (the developer loop this channel exists for) the copy's
  /// size and SHA-256 no longer match, and every retry would fail until the app
  /// is restarted. Keeps [_pending] in step so a resume does not re-show stale
  /// data. Returns null when the hub cannot be reached.
  Future<AppUpdateInfo?> _refresh() async {
    if (!mounted) return null;
    final fresh = await _service.check(
      hubUrl: _hubUrl(),
      token: SettingsService.instance.pairingToken,
    );
    if (mounted && fresh != null && fresh.updateAvailable) _pending = fresh;
    return fresh;
  }

  Future<void> _show() async {
    final info = _pending;
    if (info == null || !mounted || _dialogOpen) return;
    _dialogOpen = true;
    try {
      final navigator = await _navigatorContext();
      if (navigator == null || !navigator.mounted || !mounted) return;
      final result = await showDialog<_GateResult>(
        context: navigator,
        barrierDismissible: false,
        builder: (_) => PopScope(
          canPop: false,
          child: _UpdateDialog(
            info: info,
            service: _service,
            token: () => SettingsService.instance.pairingToken,
            refresh: _refresh,
          ),
        ),
      );
      if (result == _GateResult.later && mounted) _pending = null;
    } catch (e) {
      debugPrint('AppUpdateGate: could not show the dialog (${e.runtimeType})');
    } finally {
      _dialogOpen = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    // Re-offer the gate on every resume, so a user cannot dodge it by
    // backgrounding the app instead of updating.
    return _UpdateResumeWatcher(
      onResume: () {
        if (!mounted) return;
        if (_pending != null) {
          unawaited(_show());
        } else {
          unawaited(_check());
        }
      },
      child: widget.child,
    );
  }
}

/// The blocking dialog. Owns its own working / status state, so the install
/// keeps reporting even though the dialog lives in the Navigator's overlay and
/// not inside the gate's subtree.
class _UpdateDialog extends StatefulWidget {
  const _UpdateDialog({
    required this.info,
    required this.service,
    required this.token,
    required this.refresh,
  });

  final AppUpdateInfo info;
  final AppUpdateService service;
  final String Function() token;

  /// Re-reads the published manifest (see `_AppUpdateGateState._refresh`).
  final Future<AppUpdateInfo?> Function() refresh;

  @override
  State<_UpdateDialog> createState() => _UpdateDialogState();
}

class _UpdateDialogState extends State<_UpdateDialog> {
  bool _working = false;
  String? _status;

  /// The manifest this dialog acts on: [_UpdateDialog.info] until a tap on
  /// "Update now" re-reads it and finds the hub republished.
  late AppUpdateInfo _info = widget.info;

  Future<void> _act() async {
    setState(() {
      _working = true;
      _status =
          _info.playManaged ? 'Opening Google Play...' : 'Downloading...';
    });
    if (!_info.playManaged) {
      final fresh = await _refreshed();
      if (!mounted) return;
      if (fresh != null && !fresh.updateAvailable) {
        setState(() {
          _working = false;
          _status = 'No update is available any more.';
        });
        return;
      }
      if (fresh != null) setState(() => _info = fresh);
    }
    String line;
    try {
      line = await widget.service.install(_info, token: widget.token());
    } catch (_) {
      line = 'The update could not be started. Try again.';
    }
    if (!mounted) return;
    setState(() {
      _working = false;
      _status = line;
    });
  }

  /// Null when the hub cannot be reached: the download below then reports the
  /// real problem against the info the dialog already has.
  Future<AppUpdateInfo?> _refreshed() async {
    try {
      return await widget.refresh();
    } catch (_) {
      return null;
    }
  }

  Future<void> _later() async {
    await widget.service.dismiss(_info.versionCode);
    if (mounted) Navigator.of(context).pop(_GateResult.later);
  }

  @override
  Widget build(BuildContext context) {
    final info = _info;
    return AlertDialog(
      scrollable: true,
      title: Text(
        info.playManaged
            ? 'Update required'
            : 'Update required: ${info.versionName}',
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            info.playManaged
                ? 'Google Play has a newer version of ScreenSync '
                    '(build ${info.versionCode}). Play installs it for '
                    'you, and the app stays blocked until it is done.'
                : 'ScreenSync ${info.versionName} is published and this '
                    'build is out of date. Install it to continue, or '
                    'choose Later to be asked again tomorrow.',
          ),
          if (info.sha256.isNotEmpty) ...<Widget>[
            const SizedBox(height: 10),
            Text('SHA-256 ${info.shortSha}',
                style: const TextStyle(fontSize: 11)),
          ],
          if (_status != null) ...<Widget>[
            const SizedBox(height: 10),
            Text(_status!, style: const TextStyle(fontSize: 12)),
          ],
        ],
      ),
      actions: <Widget>[
        if (!info.playManaged)
          TextButton(
            onPressed: _working ? null : _later,
            child: const Text('Later'),
          ),
        FilledButton.icon(
          onPressed: _working ? null : _act,
          icon: const Icon(Icons.download_rounded, size: 18),
          label: Text(_working ? 'Working...' : 'Update now'),
        ),
      ],
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
