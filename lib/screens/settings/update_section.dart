import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../services/app_update_service.dart';
import '../../services/device_intent_service.dart';
import '../../services/settings_service.dart';
import '../dashboard/detail_cards.dart';

/// Settings panel for app updates: the opt-out switch for automatic checks,
/// the installed version and which channel updates it, and a "Check now" button
/// that always works, switch on or off, and says why when it finds nothing.
class UpdateSection extends StatefulWidget {
  const UpdateSection({super.key, this.service, this.hubUrlResolver});

  /// Test seam: replaces [AppUpdateService.instance].
  @visibleForTesting
  final AppUpdateService? service;

  /// Test seam: replaces the hub URL read from the ScreenCaptureBloc.
  @visibleForTesting
  final String Function(BuildContext context)? hubUrlResolver;

  @override
  State<UpdateSection> createState() => _UpdateSectionState();
}

class _UpdateSectionState extends State<UpdateSection> {
  bool _auto = true;
  bool? _playOwned;
  String _version = '';
  bool _checking = false;
  bool _busy = false;
  AppUpdateInfo? _info;
  String? _message;
  bool _messageIsError = false;
  String? _installStatus;

  AppUpdateService get _service => widget.service ?? AppUpdateService.instance;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final auto = await _service.autoCheckEnabled();
    final playOwned = await _service.isPlayOwned();
    final version = await DeviceIntentService.appVersion();
    if (!mounted) return;
    setState(() {
      _auto = auto;
      _playOwned = playOwned;
      _version = version.code > 0
          ? '${version.name} (build ${version.code})'
          : version.name;
    });
  }

  Future<void> _setAuto(bool value) async {
    setState(() => _auto = value);
    await _service.setAutoCheckEnabled(value);
  }

  String _hubUrl() =>
      (widget.hubUrlResolver ?? _hubUrlFromBloc)(context);

  static String _hubUrlFromBloc(BuildContext context) =>
      context.read<ScreenCaptureBloc>().screenRepository.hubUrl;

  Future<void> _checkNow() async {
    setState(() {
      _checking = true;
      _info = null;
      _message = null;
      _installStatus = null;
    });
    AppUpdateInfo? info;
    String? error;
    try {
      info = await _service.check(
        hubUrl: _hubUrl(),
        token: SettingsService.instance.pairingToken,
        manual: true,
      );
      error = _service.lastCheckError;
    } catch (_) {
      error = 'Update check failed.';
    }
    if (!mounted) return;
    setState(() {
      _checking = false;
      if (info != null && info.updateAvailable) {
        _info = info;
        _message = info.playManaged
            ? 'Update available: build ${info.versionCode}'
            : 'Update available: ${info.versionName}';
        _messageIsError = false;
      } else if (error != null) {
        _message = error;
        _messageIsError = true;
      } else {
        _message = 'You are on the latest version.';
        _messageIsError = false;
      }
    });
  }

  Future<void> _install() async {
    final info = _info;
    if (info == null) return;
    setState(() {
      _busy = true;
      _installStatus = info.playManaged
          ? 'Opening Google Play...'
          : 'Downloading ${info.versionName}...';
    });
    String line;
    try {
      line = await _service.install(info,
          token: SettingsService.instance.pairingToken);
    } catch (_) {
      line = 'The update could not be started. Try again.';
    }
    if (!mounted) return;
    setState(() {
      _busy = false;
      _installStatus = line;
    });
  }

  String get _channelLine {
    final owner = switch (_playOwned) {
      null => 'checking...',
      true => 'updates come from Google Play',
      false => 'updates come from your ScreenSync hub',
    };
    return _version.isEmpty ? owner : 'Version $_version - $owner';
  }

  @override
  Widget build(BuildContext context) {
    final dim = AppTheme.typeBodyMedium.copyWith(color: AppTheme.darkTextDim);
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: GlassPanel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const SectionHeader(
              icon: Icons.system_update_rounded,
              gradient: AppTheme.gradPrimary,
              title: 'App updates',
            ),
            SwitchListTile(
              activeThumbColor: AppTheme.primary,
              contentPadding: EdgeInsets.zero,
              title: const Text('Check for updates automatically',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
              subtitle: Text(
                  'Looks for a newer build when the app opens and in the '
                  'background. "Check now" below always works.',
                  style: dim),
              value: _auto,
              onChanged: _setAuto,
            ),
            Text(_channelLine, style: dim),
            const SizedBox(height: 8),
            if (_message != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  _message!,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: _messageIsError ? AppTheme.danger : null,
                  ),
                ),
              ),
            if (_installStatus != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(_installStatus!,
                    style: const TextStyle(fontSize: 12)),
              ),
            Wrap(
              spacing: 8,
              children: <Widget>[
                OutlinedButton.icon(
                  onPressed: _checking || _busy ? null : _checkNow,
                  icon: _checking
                      ? const SizedBox.square(
                          dimension: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.refresh_rounded, size: 18),
                  label: Text(_checking ? 'Checking...' : 'Check now'),
                ),
                if (_info != null)
                  FilledButton.icon(
                    onPressed: _busy ? null : _install,
                    icon: const Icon(Icons.download_rounded, size: 18),
                    label: Text(_busy ? 'Working...' : 'Update now'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
