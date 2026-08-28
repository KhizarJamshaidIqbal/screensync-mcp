import 'package:flutter/material.dart';
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
            ],
          ),
        );
      },
    );
  }
}
