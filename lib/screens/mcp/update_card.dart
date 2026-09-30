import 'package:flutter/material.dart';

import '../../core/app_theme.dart';
import '../../services/app_update_service.dart';

/// OTA card for the MCP tab: shows the newest build the owning channel knows
/// about (the hub for a sideloaded build, Google Play for a store build) and
/// installs it through that same channel.
class AppUpdateCard extends StatefulWidget {
  const AppUpdateCard({
    super.key,
    required this.hubUrl,
    required this.token,
    this.service,
  });

  final String hubUrl;
  final String token;

  /// Test seam: replaces [AppUpdateService.instance].
  @visibleForTesting
  final AppUpdateService? service;

  @override
  State<AppUpdateCard> createState() => _AppUpdateCardState();
}

class _AppUpdateCardState extends State<AppUpdateCard> {
  AppUpdateInfo? _info;
  bool _checking = true;
  bool _checked = false;
  bool _busy = false;
  String? _error;
  String? _status;

  AppUpdateService get _service => widget.service ?? AppUpdateService.instance;

  @override
  void initState() {
    super.initState();
    _startup();
  }

  /// Opening the tab checks automatically, unless the user switched automatic
  /// checks off: then the card waits for a tap on "Check now".
  Future<void> _startup() async {
    if (await _service.autoCheckEnabled()) return _check(manual: false);
    if (mounted) setState(() => _checking = false);
  }

  Future<void> _check({bool manual = true}) async {
    // _startup() reaches here after an await: the tab may be gone by then.
    if (!mounted) return;
    setState(() => _checking = true);
    AppUpdateInfo? info;
    String? error;
    try {
      info = await _service.check(
        hubUrl: widget.hubUrl,
        token: widget.token,
        manual: manual,
      );
      error = _service.lastCheckError;
    } catch (_) {
      error = 'Update check failed.';
    }
    if (!mounted) return;
    setState(() {
      _info = info;
      _error = error;
      _checking = false;
      _checked = true;
    });
  }

  Future<void> _install() async {
    final info = _info;
    if (info == null) return;
    setState(() {
      _busy = true;
      _status = info.playManaged
          ? 'Opening Google Play...'
          : 'Downloading ${info.versionName}...';
    });
    String line;
    try {
      line = await _service.install(info, token: widget.token);
    } catch (_) {
      line = 'The update could not be started. Try again.';
    }
    if (!mounted) return;
    setState(() {
      _busy = false;
      _status = line;
    });
  }

  String get _headline {
    final info = _info;
    if (_checking && !_checked) return 'Checking for updates...';
    if (info?.updateAvailable == true) {
      return 'Update available: ${info!.versionName}';
    }
    if (_error != null) return 'Could not check for updates';
    if (!_checked) return 'Automatic update checks are off';
    return 'App is up to date';
  }

  String get _detail {
    final info = _info;
    if (info != null && info.playManaged) {
      return 'Google Play has build ${info.versionCode} ready and installs it '
          'for you.';
    }
    if (info != null) {
      return 'Newest published build: ${info.versionName} '
          '(${info.versionCode}) - '
          '${(info.sizeBytes / 1048576).toStringAsFixed(1)} MB';
    }
    if (_error != null) return _error!;
    if (!_checked) return 'Tap Check now to look for a newer build.';
    return 'You are on the newest published build.';
  }

  @override
  Widget build(BuildContext context) {
    final info = _info;
    final available = info?.updateAvailable == true;
    final failed = _error != null && info == null;
    return GlassPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                available
                    ? Icons.system_update_rounded
                    : failed
                        ? Icons.cloud_off_rounded
                        : Icons.verified_rounded,
                size: 18,
                color: available
                    ? AppTheme.warning
                    : failed
                        ? AppTheme.danger
                        : AppTheme.success,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  _headline,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(_detail, style: const TextStyle(fontSize: 12)),
          if (available && info!.sha256.isNotEmpty) ...<Widget>[
            const SizedBox(height: 4),
            Text('SHA-256 ${info.shortSha}',
                style: const TextStyle(fontSize: 11)),
          ],
          if (_status != null) ...<Widget>[
            const SizedBox(height: 6),
            Text(_status!, style: const TextStyle(fontSize: 12)),
          ],
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed:
                  _busy || _checking ? null : (available ? _install : _check),
              icon: Icon(
                available ? Icons.download_rounded : Icons.refresh_rounded,
                size: 16,
              ),
              label: Text(available
                  ? 'Update now'
                  : (_checked ? 'Check again' : 'Check now')),
            ),
          ),
        ],
      ),
    );
  }
}
