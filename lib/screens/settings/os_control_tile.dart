import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../../widgets/common_widgets.dart';

/// Host-level switch for the OS plane (os_mouse_click / os_type / os_hotkey).
///
/// Those tools move the real mouse and type real keys anywhere on the machine, so they are
/// deliberately NOT inherited from the browser web-access toggle. The value lives on the
/// hub rather than in local preferences, which is why this tile talks to /api/os-control
/// instead of using SettingsService like the switches around it.
///
/// [hubUrl] and [token] come from the caller, which resolves them exactly like the rest of
/// the app does (`ScreenRepository.hubUrl` / `pairingToken`: manual override, then the mDNS-
/// discovered hub, then the build default). The tile used to read only the manual override
/// and a build-time 127.0.0.1 default, so on a phone that found its hub over mDNS it asked
/// the phone itself and reported "hub unreachable".
class OsControlTile extends StatefulWidget {
  const OsControlTile({
    super.key,
    required this.hubUrl,
    required this.token,
    this.hubOnline = true,
    this.client,
  });

  final String hubUrl;
  final String token;

  /// The hub answered its last health check; a false -> true flip reloads the switch.
  final bool hubOnline;

  /// Injected by tests; production uses a short-lived client per request.
  final http.Client? client;

  @override
  State<OsControlTile> createState() => _OsControlTileState();
}

class _OsControlTileState extends State<OsControlTile> {
  bool _enabled = false;
  bool _busy = true;
  String _source = 'off';
  String _error = '';

  /// Bumped per load so a slow response for an old hub cannot overwrite a newer one.
  int _loadId = 0;

  String get _base {
    final url = widget.hubUrl.trim();
    return url.endsWith('/') ? url.substring(0, url.length - 1) : url;
  }

  Map<String, String> _headers({bool json = false}) => {
        if (json) 'Content-Type': 'application/json',
        'Authorization': 'Bearer ${widget.token}',
      };

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant OsControlTile oldWidget) {
    super.didUpdateWidget(oldWidget);
    final moved = oldWidget.hubUrl != widget.hubUrl ||
        oldWidget.token != widget.token ||
        (widget.hubOnline && !oldWidget.hubOnline);
    if (moved) _load();
  }

  Future<T> _withClient<T>(Future<T> Function(http.Client client) run) async {
    final client = widget.client ?? http.Client();
    try {
      return await run(client);
    } finally {
      if (widget.client == null) client.close();
    }
  }

  Future<void> _load() async {
    final id = ++_loadId;
    if (mounted) setState(() => _busy = true);
    try {
      final res = await _withClient((c) => c
          .get(Uri.parse('$_base/api/os-control'), headers: _headers())
          .timeout(const Duration(seconds: 8)));
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      if (!mounted || id != _loadId) return;
      setState(() {
        _enabled = body['enabled'] == true;
        _source = (body['source'] ?? 'off').toString();
        _busy = false;
        _error = res.statusCode == 200 ? '' : 'hub said ${res.statusCode}';
      });
    } catch (_) {
      if (!mounted || id != _loadId) return;
      setState(() {
        _busy = false;
        _error = 'hub unreachable';
      });
    }
  }

  Future<void> _set(bool value) async {
    setState(() => _busy = true);
    try {
      final res = await _withClient((c) => c
          .post(Uri.parse('$_base/api/os-control'),
              headers: _headers(json: true),
              body: jsonEncode({'enabled': value}))
          .timeout(const Duration(seconds: 8)));
      if (!mounted) return;
      // A rejected token (401) must not look like "turned off": keep the
      // previous value and say what the hub answered. Checked before decoding
      // so a non-JSON error page is not reported as "could not reach the hub".
      if (res.statusCode != 200) {
        setState(() {
          _busy = false;
          _error = 'hub said ${res.statusCode}';
        });
        return;
      }
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      setState(() {
        _enabled = body['enabled'] == true;
        _source = (body['source'] ?? 'off').toString();
        _busy = false;
        _error = '';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'could not reach the hub';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final subtitle = _error.isNotEmpty
        ? '$_error - the setting is unchanged.'
        : _source == 'env'
            ? 'Enabled by SCREENSYNC_ALLOW_OS_CONTROL on the hub host.'
            : 'Lets the agent move the real mouse and type real keys anywhere on this '
                'computer, not only inside a browser tab. Off by default.';
    return SwitchListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      title: const Text('Allow OS-level control', style: TextStyle(fontSize: 13)),
      subtitle: Text(subtitle, style: TextStyle(fontSize: 11, color: dimColor(context))),
      value: _enabled,
      onChanged: _busy || _source == 'env' ? null : _set,
    );
  }
}
