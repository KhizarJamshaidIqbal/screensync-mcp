import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../blocs/screen_capture_bloc.dart';
import '../core/app_theme.dart';
import '../widgets/app_dialog.dart';
import '../widgets/common_widgets.dart';
import 'annotate_screen.dart';
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
      _celebrationSynced = state.hubOnline == true;
    });
    Future.delayed(const Duration(milliseconds: 2600), () {
      if (mounted) setState(() => _showCelebration = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    return BlocConsumer<ScreenCaptureBloc, ScreenCaptureState>(
      listenWhen: (previous, current) =>
          previous.status != current.status ||
          previous.errorMessage != current.errorMessage ||
          previous.regionRequestId != current.regionRequestId ||
          previous.liveConnected != current.liveConnected,
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
        if (state.regionRequestId != _lastRegionId &&
            state.regionBytes != null) {
          _lastRegionId = state.regionRequestId;
          _openRegionEditor(context, state);
          return;
        }
        if (state.status == CaptureStatus.success) {
          HapticFeedback.mediumImpact();
          _celebrate(state);
        } else if (state.errorMessage != null) {
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
                          'v2.5',
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
                child: _ConnectionToggleButton(
                  connected:
                      state.hubOnline == true || state.liveConnected == true,
                  busy: state.discovering,
                  onDisconnect: () => _confirmDisconnect(
                      context, context.read<ScreenCaptureBloc>()),
                  onConnect: () => context
                      .read<ScreenCaptureBloc>()
                      .add(AutoConnectHubEvent()),
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

/// Polished pill button that lives in the app bar and reflects the live
/// connection state:
///  - connected  -> a filled "Live" pill with a pulsing dot; tap disconnects.
///  - disconnected-> a subtle outlined "Connect" pill; tap auto-connects.
class _ConnectionToggleButton extends StatelessWidget {
  const _ConnectionToggleButton({
    required this.connected,
    required this.busy,
    required this.onDisconnect,
    required this.onConnect,
  });

  final bool connected;
  final bool busy;
  final VoidCallback onDisconnect;
  final VoidCallback onConnect;

  @override
  Widget build(BuildContext context) {
    final Color accent = connected ? AppTheme.success : AppTheme.primary;
    final String label = busy
        ? 'Connecting'
        : connected
            ? 'Live'
            : 'Connect';

    return Tooltip(
      message: connected
          ? 'Close ScreenSync MCP connection'
          : 'Connect to ScreenSync hub',
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(999),
          onTap: busy ? null : (connected ? onDisconnect : onConnect),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 260),
            curve: Curves.easeOut,
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
            decoration: BoxDecoration(
              gradient: connected
                  ? LinearGradient(colors: [
                      accent.withValues(alpha: 0.22),
                      accent.withValues(alpha: 0.10),
                    ])
                  : null,
              color: connected ? null : Colors.transparent,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(
                color: accent.withValues(alpha: connected ? 0.55 : 0.40),
                width: 1,
              ),
              boxShadow: connected
                  ? [
                      BoxShadow(
                        color: accent.withValues(alpha: 0.28),
                        blurRadius: 10,
                        offset: const Offset(0, 3),
                      ),
                    ]
                  : null,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (busy)
                  SizedBox(
                    width: 11,
                    height: 11,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation<Color>(accent),
                    ),
                  )
                else if (connected)
                  _PulsingDot(color: accent)
                else
                  Icon(Icons.power_settings_new_rounded,
                      size: 13, color: accent),
                const SizedBox(width: 6),
                Text(
                  label,
                  style: AppTheme.microLabel.copyWith(
                    color: accent,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.2,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A small dot that gently pulses to signal a live connection.
class _PulsingDot extends StatelessWidget {
  const _PulsingDot({required this.color});
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(color: color.withValues(alpha: 0.6), blurRadius: 6),
        ],
      ),
    )
        .animate(onPlay: (c) => c.repeat(reverse: true))
        .fadeIn(duration: 700.ms)
        .scaleXY(begin: 0.85, end: 1.15, duration: 700.ms, curve: Curves.easeInOut);
  }
}

/// Animated capture-success card: shows the ACTUAL captured pixels so the
/// user gets instant proof the tap worked — even before any hub exists.
class CaptureCelebration extends StatelessWidget {
  const CaptureCelebration(
      {super.key, required this.framePath, required this.synced});

  final String? framePath;
  final bool synced;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Theme.of(context).brightness == Brightness.dark
              ? const Color(0xF0111827)
              : Colors.white,
          borderRadius: BorderRadius.circular(AppTheme.radiusL),
          border: Border.all(color: AppTheme.success.withValues(alpha: 0.65)),
          boxShadow: [
            BoxShadow(
              color: AppTheme.success.withValues(alpha: 0.25),
              blurRadius: 24,
              spreadRadius: 2,
            ),
          ],
        ),
        child: Row(
          children: [
            if (framePath != null && File(framePath!).existsSync())
              ClipRRect(
                borderRadius: BorderRadius.circular(AppTheme.radiusS),
                child: Image.file(
                  File(framePath!),
                  width: 46,
                  height: 82,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                ),
              )
            else
              Container(
                width: 46,
                height: 82,
                decoration: BoxDecoration(
                  color: AppTheme.success.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(AppTheme.radiusS),
                ),
                child: const Icon(Icons.image_rounded,
                    color: AppTheme.success, size: 22),
              ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.check_circle_rounded,
                          color: AppTheme.success, size: 18),
                      SizedBox(width: 6),
                      Text('Captured!',
                          style: TextStyle(
                              fontWeight: FontWeight.w800, fontSize: 15)),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    synced
                        ? 'Frame delivered — your AI can see it now.'
                        : 'Saved to Gallery. It will sync when the hub connects.',
                    style: TextStyle(fontSize: 12, color: dimColor(context)),
                  ),
                ],
              ),
            ),
            if (framePath != null)
              IconButton(
                tooltip: 'Annotate / redact',
                icon: const Icon(Icons.draw_rounded,
                    color: AppTheme.accentCyan, size: 22),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(
                      builder: (_) => AnnotateScreen(imagePath: framePath!)),
                ),
              ),
          ],
        ),
      ),
    )
        .animate()
        .slideY(begin: 0.4, end: 0, duration: 340.ms, curve: Curves.easeOutBack)
        .fadeIn(duration: 220.ms)
        .then(delay: 1900.ms)
        .fadeOut(duration: 350.ms);
  }
}
