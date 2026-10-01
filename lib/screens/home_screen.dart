import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../blocs/screen_capture_bloc.dart';
import '../core/app_theme.dart';
import '../services/device_intent_service.dart';
import '../services/settings_service.dart';
import '../widgets/app_dialog.dart';
import '../widgets/common_widgets.dart';
import '../widgets/connect_prompt_dialog.dart';
import 'home/capture_celebration.dart';
import 'home/capture_transitions.dart';
import 'home/connection_toggle_button.dart';
import 'pair_scan_screen.dart';
import 'hub_screen.dart';
import 'region_crop_screen.dart';
import 'tabs/dashboard_tab.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  // Capture celebration overlay state (the "it works!" moment).
  bool _showCelebration = false;
  String? _celebrationPath;
  bool _celebrationSynced = false;

  int _lastRegionId = 0;
  bool _cropOpen = false;

  /// One-shot celebrate / error-toast decisions (transitions, not values).
  final _transitions = CaptureTransitions();

  /// "Connect your hub" prompt: shown once after install, then again on
  /// every drop of the hub link. Skipping silences it until the next drop.
  bool _promptOpen = false;
  bool _promptSkippedForThisDrop = false;
  bool? _wasHubOnline;

  /// Real version, so the app-bar badge stops claiming "v2.5" forever.
  String _appVersionLabel = '';

  @override
  void initState() {
    super.initState();
    _loadAppVersion();
  }

  Future<void> _loadAppVersion() async {
    final v = await DeviceIntentService.appVersion();
    if (!mounted) return;
    setState(() => _appVersionLabel = 'v${v.name}');
  }

  /// A1: selected primary destination (Dashboard · Gallery · Diagnose ·
  /// MCP · Settings). Bodies preserved in an IndexedStack.

  /// F2: last live-connection value we showed a toast for.
  bool? _lastLiveToast;

  /// Opens the full-screen region crop editor with the freshly captured
  /// full frame, then commits the chosen crop rect back to the BLoC.
  Future<void> _openRegionEditor(BuildContext context, ScreenCaptureState state) async {
    final bytes = state.regionBytes;
    if (bytes == null || _cropOpen) return;
    _cropOpen = true;
    final bloc = context.read<ScreenCaptureBloc>();
    final result = await Navigator.of(context).push<RegionCropResult>(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => RegionCropScreen(imageBytes: bytes),
      ),
    );
    _cropOpen = false;
    if (result != null) {
      bloc.add(CommitRegionCropEvent(result.rect));
    } else {
      bloc.add(const ClearRegionRequestEvent());
    }
  }

  void _celebrate(ScreenCaptureState state) {
    setState(() {
      _showCelebration = true;
      _celebrationPath = state.latestFramePath;
      // "Delivered" only when the hub is reachable AND accepts our token.
      _celebrationSynced = state.hubOnline == true && !state.hubAuthFailed;
    });
    Future.delayed(const Duration(milliseconds: 2600), () {
      if (mounted) setState(() => _showCelebration = false);
    });
  }

  /// Shows the "connect your hub" prompt once after install, and again
  /// after every drop of the hub link. Skip silences one outage only.
  Future<void> _maybeShowConnectPrompt(
      BuildContext context, ScreenCaptureState state) async {
    if (_promptOpen || !mounted) return;

    final online = hubLinkUp(state);
    final was = _wasHubOnline;
    _wasHubOnline = online;

    final dropped = was == true && !online;
    // A fresh drop re-arms the prompt, so skipping silences one outage only.
    if (dropped) _promptSkippedForThisDrop = false;

    final firstRun = !SettingsService.instance.connectPromptShown;
    if (!firstRun && !dropped) return;
    if (_promptSkippedForThisDrop) return;

    if (firstRun) SettingsService.instance.connectPromptShown = true;
    await _runConnectPrompt(context, state);
  }

  Future<void> _runConnectPrompt(
      BuildContext context, ScreenCaptureState state) async {
    // Captured before the await so no BuildContext is used across an
    // async gap.
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    _promptOpen = true;
    final result = await showConnectPrompt(
      context,
      hubUrl: state.hubUrl,
      online: state.hubOnline == true && !state.hubAuthFailed,
    );
    _promptOpen = false;
    if (!mounted) return;
    if (result == ConnectPromptResult.scan) {
      await navigator.push(
        MaterialPageRoute(builder: (_) => const PairScanScreen()),
      );
    } else if (result == ConnectPromptResult.recent) {
      // The bloc is already reconnecting to the saved hub.
      messenger.showSnackBar(const SnackBar(
        content: Text('Reconnecting to the saved hub...'),
      ));
    } else {
      _promptSkippedForThisDrop = true;
    }
  }

  @override
  Widget build(BuildContext context) {
    return BlocConsumer<ScreenCaptureBloc, ScreenCaptureState>(
      listenWhen: (previous, current) =>
          previous.status != current.status ||
          previous.errorMessage != current.errorMessage ||
          previous.regionRequestId != current.regionRequestId ||
          previous.liveConnected != current.liveConnected ||
          previous.hubOnline != current.hubOnline ||
          previous.hubAuthFailed != current.hubAuthFailed,
      listener: (context, state) {
        // F2: reconnect/disconnect toasts (backoff handled by the service).
        if (_lastLiveToast != null && _lastLiveToast != state.liveConnected) {
          ScaffoldMessenger.of(context)
            ..hideCurrentSnackBar()
            ..showSnackBar(SnackBar(
              behavior: SnackBarBehavior.floating,
              duration: const Duration(seconds: 2),
              content: Text(state.liveConnected
                  ? 'Live stream reconnected.'
                  : 'Live stream lost — retrying with backoff…'),
            ));
        }
        _lastLiveToast = state.liveConnected;
        _maybeShowConnectPrompt(context, state);
        // Observed before the region early return so the tracker never misses
        // a transition.
        final reaction = _transitions.observe(state);
        if (state.regionRequestId != _lastRegionId &&
            state.regionBytes != null) {
          _lastRegionId = state.regionRequestId;
          _openRegionEditor(context, state);
          return;
        }
        if (reaction.celebrate) {
          HapticFeedback.mediumImpact();
          _celebrate(state);
        }
        if (reaction.showError) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(state.errorMessage!)),
          );
        }
      },
      builder: (context, state) {
        // Single-screen layout: Dashboard only. Other tabs (Gallery,
        // Diagnose, MCP, Settings) remain reachable via the layers/hub icon
        // in the app bar (HubScreen). No bottom navigation bar.
        return Scaffold(
          body: Stack(
            children: [
              const SafeArea(
                bottom: false,
                child: DashboardTab(onQuality: _noop),
              ),
              if (_showCelebration)
                Positioned(
                  left: 16,
                  right: 16,
                  bottom: 24,
                  child: CaptureCelebration(
                    framePath: _celebrationPath,
                    synced: _celebrationSynced,
                  ),
                ),
            ],
          ),
          appBar: AppBar(
            titleSpacing: 12,
            title: Row(
              children: [
                Container(
                  width: 30,
                  height: 30,
                  decoration: BoxDecoration(
                    gradient: AppTheme.gradPrimary,
                    borderRadius: BorderRadius.circular(9),
                    boxShadow: [
                      BoxShadow(
                        color: AppTheme.primary.withValues(alpha: 0.4),
                        blurRadius: 8,
                        offset: const Offset(0, 3),
                      ),
                    ],
                  ),
                  child: const Icon(Icons.auto_awesome_rounded,
                      color: Colors.white, size: 15),
                ),
                const SizedBox(width: 10),
                // Flexible so the brand block never forces an overflow on
                // narrow screens; it shrinks/ellipsizes before pushing the
                // trailing actions off-screen.
                Flexible(
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Flexible(
                        child: Text(
                          'ScreenSync',
                          overflow: TextOverflow.ellipsis,
                          softWrap: false,
                        ),
                      ),
                      const SizedBox(width: 5),
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          'MCP',
                          style: AppTheme.microLabel
                              .copyWith(color: AppTheme.darkTextDim),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 7, vertical: 3),
                        decoration: BoxDecoration(
                          color: AppTheme.success.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(
                              color: AppTheme.success.withValues(alpha: 0.35)),
                        ),
                        child: Text(
                          _appVersionLabel,
                          style: AppTheme.microLabel
                              .copyWith(color: AppTheme.success),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            actions: [
              Semantics(
                label: 'Connection toggle',
                child: ConnectionToggleButton(
                  // Reachable is not connected: a hub that rejects our token
                  // answers /health but refuses every real call.
                  connected: (state.hubOnline == true && !state.hubAuthFailed) ||
                      state.liveConnected == true,
                  authProblem: state.hubOnline == true &&
                      state.hubAuthFailed &&
                      state.liveConnected != true,
                  busy: state.discovering,
                  onDisconnect: () => _confirmDisconnect(
                      context, context.read<ScreenCaptureBloc>()),
                  onConnect: () => context
                      .read<ScreenCaptureBloc>()
                      .add(AutoConnectHubEvent()),
                  onRepair: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const PairScanScreen()),
                  ),
                ),
              ),
              const SizedBox(width: 2),
              Semantics(
                label: 'Open hub',
                child: IconButton(
                  tooltip: 'Open hub',
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.layers_rounded),
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const HubScreen()),
                  ),
                ),
              ),
              const ThemeQuickToggle(),
              const SizedBox(width: 4),
            ],
          ),
        );
      },
    );
  }

  static void _noop() {}

  /// Ask before tearing down the live link so an accidental tap doesn't kill
  /// an active session. On confirm, fully closes the MCP server connection.
  Future<void> _confirmDisconnect(
      BuildContext context, ScreenCaptureBloc bloc) async {
    final ok = await AppDialog.show<bool>(
      context,
      eyebrow: 'Connection',
      title: 'Disconnect ScreenSync?',
      message:
          'This closes the ScreenSync MCP server connection. It will stop '
          'staying connected in the background until you connect again.',
      icon: Icons.power_settings_new_rounded,
      tone: AppDialogTone.danger,
      actions: [
        AppDialogAction(
          label: 'Cancel',
          onPressed: () => Navigator.of(context, rootNavigator: true).pop(false),
        ),
        AppDialogAction(
          label: 'Disconnect',
          primary: true,
          onPressed: () => Navigator.of(context, rootNavigator: true).pop(true),
        ),
      ],
    );
    if (ok == true) {
      HapticFeedback.mediumImpact();
      bloc.add(DisconnectHubEvent());
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('ScreenSync MCP connection closed.'),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }
}
