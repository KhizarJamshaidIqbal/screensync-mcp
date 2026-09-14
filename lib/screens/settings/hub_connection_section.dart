import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../services/pairing_service.dart';
import '../../services/settings_service.dart';
import '../../widgets/common_widgets.dart';
import '../../widgets/ref_widgets.dart';
import '../dashboard/detail_cards.dart';
import '../pair_scan_screen.dart';

/// Hub connection panel: QR pairing, URL/token fields, mDNS discovery and
/// auto-sync switches.
class HubConnectionSection extends StatelessWidget {
  const HubConnectionSection({
    super.key,
    required this.hubUrlController,
    required this.tokenController,
  });

  final TextEditingController hubUrlController;
  final TextEditingController tokenController;

  Future<void> _scanQr(BuildContext context) async {
    await Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => const PairScanScreen()));
  }

  @override
  Widget build(BuildContext context) {
    final settings = SettingsService.instance;
    return BlocConsumer<ScreenCaptureBloc, ScreenCaptureState>(
      listenWhen: (p, c) => p.hubUrl != c.hubUrl && c.hubUrl.isNotEmpty,
      listener: (context, state) {
        if (!hubUrlController.text.contains(state.hubUrl)) {
          hubUrlController.text = state.hubUrl;
        }
      },
      builder: (context, state) {
        return GlassPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: SectionHeader(
                      icon: Icons.wifi_tethering_rounded,
                      gradient: AppTheme.gradPrimary,
                      title: 'Hub connection',
                    ),
                  ),
                  MicroChip(label: 'LAN first', color: AppTheme.accentCyan),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                'Scan the QR printed by the desktop hub (or on its /pair '
                'page). Loopback (127.0.0.1) only works on the emulator.',
                style: AppTheme.typeBodyMedium
                    .copyWith(color: AppTheme.darkTextDim),
              ),
              const SizedBox(height: 12),
              GradientActionButton(
                icon: Icons.qr_code_scanner_rounded,
                label: 'Scan QR code',
                onTap: () => _scanQr(context),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: hubUrlController,
                keyboardType: TextInputType.url,
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  labelText: 'Hub URL or pairing link',
                  helperText:
                      'Accepts http://IP:3000 or screensync://pair?… from the desktop hub',
                  helperMaxLines: 2,
                  isDense: true,
                ),
                onChanged: (text) {
                  // Auto-apply pasted pairing links: fills URL + token.
                  if (!text.trimLeft().startsWith('screensync://') &&
                      !text.trimLeft().startsWith('{')) {
                    return;
                  }
                  final parsed = PairingService.parse(text);
                  if (parsed == null) return;
                  hubUrlController.text = parsed.url;
                  tokenController.text =
                      parsed.token == 'screensync-local-dev'
                          ? ''
                          : parsed.token;
                  final bloc = context.read<ScreenCaptureBloc>();
                  bloc.add(SetPairingTokenEvent(parsed.token));
                  bloc.add(SetHubUrlEvent(parsed.url));
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                      content: Text('Pairing link applied — connecting…')));
                },
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () =>
                          context.read<ScreenCaptureBloc>().add(
                                SetHubUrlEvent(hubUrlController.text),
                              ),
                      icon: const Icon(Icons.save_rounded, size: 18),
                      label: const Text('Save & ping'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: state.discovering
                          ? null
                          : () => context
                              .read<ScreenCaptureBloc>()
                              .add(DiscoverHubsEvent()),
                      icon: state.discovering
                          ? const SizedBox.square(
                              dimension: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.wifi_find_rounded, size: 18),
                      label: const Text('mDNS scan'),
                    ),
                  ),
                ],
              ),
              for (final hub in state.discoveredHubs)
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    hub.url == state.hubUrl
                        ? Icons.radio_button_checked
                        : Icons.radio_button_off,
                    color: hub.url == state.hubUrl
                        ? AppTheme.primary
                        : dimColor(context),
                    size: 20,
                  ),
                  title: Text(hub.name, style: const TextStyle(fontSize: 13)),
                  subtitle: Text(hub.url,
                      style:
                          const TextStyle(fontSize: 11, fontFamily: 'monospace')),
                  onTap: () => context
                      .read<ScreenCaptureBloc>()
                      .add(SelectHubEvent(hub)),
                ),
              const SizedBox(height: 4),
              TextField(
                controller: tokenController,
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  labelText: 'Pairing token (blank = default dev token)',
                  isDense: true,
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () {
                    final token = tokenController.text.trim();
                    context.read<ScreenCaptureBloc>().add(
                          SetPairingTokenEvent(
                            token.isEmpty ? 'screensync-local-dev' : token,
                          ),
                        );
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Pairing token saved.')),
                    );
                  },
                  icon: const Icon(Icons.vpn_key_rounded, size: 18),
                  label: const Text('Save token'),
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(
                    state.hubOnline == true
                        ? Icons.wifi_rounded
                        : Icons.wifi_off_rounded,
                    size: 16,
                    color: state.hubOnline == true
                        ? AppTheme.success
                        : dimColor(context)),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      state.hubOnline == true
                          ? 'Connected via ${state.hubSource}'
                              '${state.hubLatencyMs != null ? ' · ${state.hubLatencyMs}ms' : ''}'
                          : 'Hub offline — auto-discovery will retry',
                      style:
                          TextStyle(color: dimColor(context), fontSize: 12),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: const Text('Auto-discover hub (mDNS)',
                    style: TextStyle(fontSize: 13)),
                subtitle: Text(
                    'Zero-config: find and reconnect to the desktop hub '
                    'automatically on this network.',
                    style: TextStyle(fontSize: 11, color: dimColor(context))),
                value: settings.autoDiscover,
                onChanged: (v) => settings.autoDiscover = v,
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: const Text('Auto-sync pending frames',
                    style: TextStyle(fontSize: 13)),
                subtitle: Text(
                    'Push unsynced captures to the hub the moment it is '
                    'reachable — no manual Sync needed.',
                    style: TextStyle(fontSize: 11, color: dimColor(context))),
                value: settings.autoSync,
                onChanged: (v) => settings.autoSync = v,
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: const Text('Live mirror (this phone to the hub)',
                    style: TextStyle(fontSize: 13)),
                subtitle: Text(
                    'While on, a low-latency 480p frame is pushed every '
                    'few seconds so the hub and any connected agent see this '
                    'screen as it changes. Phone-only switch - no MCP tool '
                    'can turn it on.',
                    style: TextStyle(fontSize: 11, color: dimColor(context))),
                value: settings.liveMirrorEnabled,
                onChanged: (v) {
                  settings.liveMirrorEnabled = v;
                  context.read<ScreenCaptureBloc>().add(SetLiveMirrorEvent(v));
                },
              ),
              const _OsControlTile(),
            ],
          ),
        );
      },
    );
  }
}


/// Host-level switch for the OS plane (os_mouse_click / os_type / os_hotkey).
///
/// Those tools move the real mouse and type real keys anywhere on the machine, so they are
/// deliberately NOT inherited from the browser web-access toggle. The value lives on the
/// hub rather than in local preferences, which is why this tile talks to /api/os-control
/// instead of using SettingsService like the switches above it.
class _OsControlTile extends StatefulWidget {
  const _OsControlTile();

  @override
  State<_OsControlTile> createState() => _OsControlTileState();
}

class _OsControlTileState extends State<_OsControlTile> {
  static const _fallbackHub = String.fromEnvironment('SCREEN_SYNC_HUB_URL',
      defaultValue: 'http://127.0.0.1:3000');
  static const _fallbackToken =
      String.fromEnvironment('SCREEN_SYNC_TOKEN', defaultValue: 'screensync-local-dev');

  bool _enabled = false;
  bool _busy = true;
  String _source = 'off';
  String _error = '';

  String get _hub {
    final override = SettingsService.instance.hubUrlOverride.trim();
    final url = override.isNotEmpty ? override : _fallbackHub;
    return url.endsWith('/') ? url.substring(0, url.length - 1) : url;
  }

  String get _token {
    final t = SettingsService.instance.pairingToken.trim();
    return t.isNotEmpty ? t : _fallbackToken;
  }

  Map<String, String> _headers({bool json = false}) => {
        if (json) 'Content-Type': 'application/json',
        'Authorization': 'Bearer $_token',
      };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await http
          .get(Uri.parse('$_hub/api/os-control'), headers: _headers())
          .timeout(const Duration(seconds: 8));
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _enabled = body['enabled'] == true;
        _source = (body['source'] ?? 'off').toString();
        _busy = false;
        _error = res.statusCode == 200 ? '' : 'hub said ${res.statusCode}';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'hub unreachable';
      });
    }
  }

  Future<void> _set(bool value) async {
    setState(() => _busy = true);
    try {
      final res = await http
          .post(Uri.parse('$_hub/api/os-control'),
              headers: _headers(json: true), body: jsonEncode({'enabled': value}))
          .timeout(const Duration(seconds: 8));
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      if (!mounted) return;
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
