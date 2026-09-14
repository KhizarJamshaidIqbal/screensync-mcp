import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../blocs/screen_capture_bloc.dart';
import '../core/app_theme.dart';
import '../core/motion.dart';
import '../services/pairing_service.dart';
import '../services/settings_service.dart';
import '../widgets/app_dialog.dart';
import '../widgets/ref_widgets.dart';
import '../widgets/scan_viewfinder.dart';

/// Scans the desktop hub's pairing QR (terminal print or /pair page) and applies hub URL +
/// token with zero typing.
///
/// Three fallbacks cover the ways a scan can fail: a paste-link dialog, the last few hubs
/// this device has paired with, and a copyable link rendered as a QR on this screen.
class PairScanScreen extends StatefulWidget {
  const PairScanScreen({super.key});

  @override
  State<PairScanScreen> createState() => _PairScanScreenState();
}

class _PairScanScreenState extends State<PairScanScreen>
    with SingleTickerProviderStateMixin {
  /// A pairing payload is always a QR, so restricting the symbologies stops the decoder
  /// working on formats this flow can never accept.
  late final MobileScannerController _controller = MobileScannerController(
    formats: const <BarcodeFormat>[BarcodeFormat.qrCode],
    detectionSpeed: DetectionSpeed.noDuplicates,
    facing: CameraFacing.back,
  );
  final TextEditingController _pasteController = TextEditingController();

  // Created in initState rather than lazily. A late final initializer runs on first
  // touch, and on this screen the first touch would be dispose() if the paste dialog was
  // never opened - creating a Ticker while the element is deactivating throws.
  late final AnimationController _shake;

  bool _handled = false;
  bool _reading = true;
  bool _found = false;
  bool _stalled = false;
  Timer? _stallTimer;
  List<({String url, String token})> _recent = const [];

  @override
  void initState() {
    super.initState();
    _shake = AnimationController(vsync: this, duration: AppTheme.motionSlow);
    _recent = SettingsService.instance.recentHubs;
    // If nothing has been read after a while, offer the fallback rather than leaving the
    // user staring at a frame with no feedback.
    _stallTimer = Timer(const Duration(seconds: 12), () {
      if (mounted && _reading) setState(() => _stalled = true);
    });
  }

  @override
  void dispose() {
    _stallTimer?.cancel();
    _shake.dispose();
    _controller.dispose();
    _pasteController.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_handled) return;
    final parsed = <PairingInfo>[];
    for (final barcode in capture.barcodes) {
      final info = PairingService.parse(barcode.rawValue ?? '');
      final duplicate =
          parsed.any((e) => e.url == info?.url && e.token == info?.token);
      if (info != null && !duplicate) parsed.add(info);
    }
    if (parsed.isEmpty) return;
    if (parsed.length == 1) {
      _apply(parsed.first);
      return;
    }
    // More than one valid code in frame: never guess, because pairing to the wrong hub is
    // silent and confusing.
    _chooseAmong(parsed);
  }

  Future<void> _chooseAmong(List<PairingInfo> options) async {
    await _controller.stop();
    if (!mounted) return;
    final chosen = await showModalBottomSheet<PairingInfo>(
      context: context,
      backgroundColor: AppTheme.darkSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.radiusL)),
      ),
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 18, 20, 8),
              child: Text(
                'More than one pairing code in view',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
            for (final option in options)
              ListTile(
                leading: const Icon(Icons.qr_code_rounded),
                title: Text(option.url),
                subtitle: Text(
                  'token ${_maskToken(option.token)}',
                  style: const TextStyle(fontSize: 11),
                ),
                onTap: () => Navigator.of(sheetContext).pop(option),
              ),
          ],
        ),
      ),
    );
    if (!mounted) return;
    if (chosen == null) {
      await _controller.start();
      return;
    }
    await _apply(chosen);
  }

  static String _maskToken(String token) =>
      token.isEmpty ? '(default)' : 'â€¢â€¢â€¢â€¢${token.substring(token.length > 4 ? token.length - 4 : 0)}';

  /// The bloc is optional here: the app always provides it, a widget test may not.
  ScreenCaptureBloc? _maybeBloc() {
    try {
      return context.read<ScreenCaptureBloc>();
    } catch (_) {
      return null;
    }
  }

  Future<void> _apply(PairingInfo info) async {
    if (_handled) return;
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final bloc = _maybeBloc();
    final beat = reduceMotion(context)
        ? Duration.zero
        : AppTheme.motionSlow; // hold the success frame long enough to be seen

    setState(() {
      _handled = true;
      _found = true;
      _reading = false;
    });
    _stallTimer?.cancel();
    HapticFeedback.mediumImpact();
    // The camera may already be gone (or never have started). Pairing must not depend on
    // being able to stop it, so a failure here is swallowed rather than aborting the write.
    try {
      await _controller.stop();
    } catch (_) {
      }

    final settings = SettingsService.instance
      ..hubUrlOverride = info.url
      ..pairingToken = info.token;
    await settings.rememberHub(info.url, info.token);

    // Notify the running app. This runs after the settings write on purpose: pairing is
    // the durable action and must not be lost because a listener happened to be out of scope.
    if (bloc != null) {
      bloc
        ..add(SetHubUrlEvent(info.url))
        ..add(SetPairingTokenEvent(info.token))
        ..add(PingHubEvent());
    }

    if (beat > Duration.zero) await Future<void>.delayed(beat);
    if (!mounted) return;
    navigator.pop(true);
    messenger.showSnackBar(
      SnackBar(
        content: Text('Paired with ${info.url}'),
        backgroundColor: AppTheme.success,
      ),
    );
  }

  void _openPasteDialog() {
    _pasteController.clear();
    final errorNotifier = ValueNotifier<String?>(null);

    void reject() {
      errorNotifier.value = 'Not a valid pairing link or hub URL.';
      _shake.forward(from: 0);
      HapticFeedback.mediumImpact();
    }

    void submit(BuildContext dialogContext) {
      final info = PairingService.parse(_pasteController.text);
      if (info == null) {
        reject();
        return;
      }
      Navigator.of(dialogContext, rootNavigator: true).pop();
      _apply(info);
    }

    AppDialog.show<void>(
      context,
      eyebrow: 'Pairing',
      title: 'Paste pairing link',
      message: 'Copy the link from the hub terminal or the /pair page.',
      icon: Icons.link_rounded,
      tone: AppDialogTone.brand,
      content: ValueListenableBuilder<String?>(
        valueListenable: errorNotifier,
        builder: (context, err, _) => AnimatedBuilder(
          animation: _shake,
          builder: (context, child) => Transform.translate(
            offset: Offset(
              math.sin(_shake.value * math.pi * 6) * 9 * (1 - _shake.value),
              0,
            ),
            child: child,
          ),
          child: TextField(
            controller: _pasteController,
            maxLines: 3,
            autofocus: true,
            onSubmitted: (_) => submit(context),
            decoration: InputDecoration(
              isDense: true,
              hintText: 'screensync://pair?url=â€¦&token=***',
              errorText: err,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radiusS),
              ),
            ),
          ),
        ),
      ),
      actions: <AppDialogAction>[
        AppDialogAction(
          label: 'Cancel',
          onPressed: () => Navigator.of(context, rootNavigator: true).pop(),
        ),
        AppDialogAction(
          label: 'Pair',
          primary: true,
          onPressed: () => submit(context),
        ),
      ],
    );
  }

  Future<void> _openAppSettings() async {
    try {
      await launchUrl(Uri.parse('app-settings:'));
    } catch (_) {
      // Not every platform honours the settings deep link; the paste fallback still works.
    }
  }

  Future<void> _switchCamera() async {
    HapticFeedback.selectionClick();
    try {
      await _controller.switchCamera();
    } catch (_) {
      // A device with a single camera cannot switch; leave the current one running.
    }
  }

  Future<void> _toggleTorch() async {
    HapticFeedback.selectionClick();
    try {
      await _controller.toggleTorch();
    } catch (_) {
      // No flash, or the camera is gone: the button is already disabled in that case.
    }
  }

  Future<void> _showMyCode() async {
    final settings = SettingsService.instance;
    final url = settings.hubUrlOverride.trim().isEmpty
        ? 'http://127.0.0.1:3000'
        : settings.hubUrlOverride.trim();
    final link = 'screensync://pair?url=${Uri.encodeComponent(url)}'
        '&token=${Uri.encodeComponent(settings.pairingToken)}';
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppTheme.darkSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.radiusL)),
      ),
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Text('Your current pairing code',
                  style: TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              const Text(
                'Scan this from another device to pair it with the same hub.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: AppTheme.darkTextDim),
              ),
              const SizedBox(height: 14),
              DecoratedBox(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(AppTheme.radiusM),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: QrImageView(data: link, size: 190),
                ),
              ),
              const SizedBox(height: 12),
              TextButton.icon(
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: link));
                  if (sheetContext.mounted) Navigator.of(sheetContext).pop();
                },
                icon: const Icon(Icons.copy_rounded),
                label: const Text('Copy link'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Pair with desktop')),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final viewSize =
              (math.min(constraints.maxWidth, constraints.maxHeight) * 0.62)
                  .clamp(140.0, 280.0);
          final viewRect = Rect.fromCenter(
            center: Offset(constraints.maxWidth / 2, constraints.maxHeight / 2),
            width: viewSize,
            height: viewSize,
          );

          return ValueListenableBuilder<MobileScannerState>(
            valueListenable: _controller,
            builder: (context, state, _) {
              final failed = state.error != null;
              return Stack(
                fit: StackFit.expand,
                children: <Widget>[
                  MobileScanner(
                    controller: _controller,
                    onDetect: _onDetect,
                    // Restricting decoding to the frame keeps a stray QR elsewhere on
                    // screen from being read.
                    scanWindow: viewRect,
                    tapToFocus: true,
                    placeholderBuilder: (context) => const ColoredBox(
                      color: AppTheme.darkSurface,
                      child: Center(child: CircularProgressIndicator()),
                    ),
                    errorBuilder: (context, error) => _CameraFailure(
                      message: error.errorDetails?.message ??
                          'Use "Paste link instead" below to pair manually.',
                      onOpenSettings: _openAppSettings,
                      onPaste: _openPasteDialog,
                    ),
                  ),
                  // Only draw the scanning chrome when the camera is actually running.
                  if (!failed) ...<Widget>[
                    Center(
                      child: ScanViewfinder(
                        size: viewSize,
                        reading: _reading,
                        found: _found,
                      ),
                    ),
                    SafeArea(
                      child: Align(
                        alignment: Alignment.topCenter,
                        child: Padding(
                          padding: const EdgeInsets.only(top: 20),
                          child: AnimatedSwitcher(
                            duration: AppTheme.motionBase,
                            child: _StatusLine(
                              key: ValueKey<String>(_found
                                  ? 'found'
                                  : _reading
                                      ? 'looking'
                                      : 'idle'),
                              found: _found,
                              reading: _reading,
                            ),
                          ),
                        ),
                      ),
                    ),
                    Positioned(
                      left: 0,
                      right: 0,
                      bottom: 0,
                      child: SafeArea(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: <Widget>[
                              if (_stalled && _reading) ...<Widget>[
                                const _HintChip(
                                  text:
                                      'Still scanning? Try the torch, or paste the link.',
                                ),
                                const SizedBox(height: 10),
                              ],
                              if (_recent.isNotEmpty) ...<Widget>[
                                _RecentHubs(
                                  hubs: _recent,
                                  onPick: (entry) => _apply(
                                    PairingInfo(
                                      url: entry.url,
                                      token: entry.token,
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 10),
                              ],
                              Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: <Widget>[
                                  _ScanAction(
                                    tooltip: state.torchState == TorchState.on
                                        ? 'Turn the torch off'
                                        : 'Turn the torch on',
                                    // torchState is `unavailable` on devices without a flash,
                                    // so the control is disabled rather than inert.
                                    onPressed: state.torchState ==
                                            TorchState.unavailable
                                        ? null
                                        : _toggleTorch,
                                    icon: state.torchState == TorchState.on
                                        ? Icons.flash_on_rounded
                                        : Icons.flash_off_rounded,
                                  ),
                                  _ScanAction(
                                    tooltip: 'Switch between front and rear camera',
                                    onPressed: _switchCamera,
                                    icon: Icons.cameraswitch_rounded,
                                  ),
                                  _ScanAction(
                                    tooltip: 'Show this device\u2019s pairing code',
                                    onPressed: _showMyCode,
                                    icon: Icons.qr_code_2_rounded,
                                  ),
                                ],
                              ),
                              const SizedBox(height: 10),
                              GradientActionButton(
                                icon: Icons.content_paste_rounded,
                                label: 'Paste link instead',
                                onTap: _openPasteDialog,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              );
            },
          );
        },
      ),
    );
  }
}

class _StatusLine extends StatelessWidget {
  const _StatusLine({super.key, required this.found, required this.reading});

  final bool found;
  final bool reading;

  @override
  Widget build(BuildContext context) {
    final label = found
        ? 'Code found â€” pairingâ€¦'
        : reading
            ? 'Looking for a codeâ€¦'
            : 'Point at the QR shown by the desktop hub';
    return Text(
      label,
      style: TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: found ? AppTheme.success : Colors.white,
        shadows: const <Shadow>[Shadow(blurRadius: 8)],
      ),
    );
  }
}

class _HintChip extends StatelessWidget {
  const _HintChip({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: AppTheme.warning.withValues(alpha: 0.18),
        borderRadius: BorderRadius.circular(AppTheme.radiusS),
        border: Border.all(color: AppTheme.warning.withValues(alpha: 0.5)),
      ),
      child: Text(
        text,
        style: const TextStyle(fontSize: 11.5, color: AppTheme.warning),
      ),
    );
  }
}

class _RecentHubs extends StatelessWidget {
  const _RecentHubs({required this.hubs, required this.onPick});

  final List<({String url, String token})> hubs;
  final void Function(({String url, String token}) hub) onPick;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 34,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: hubs.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final hub = hubs[i];
          final host = Uri.tryParse(hub.url)?.host ?? hub.url;
          return ActionChip(
            avatar: const Icon(Icons.history_rounded, size: 16),
            label: Text(host, style: const TextStyle(fontSize: 11.5)),
            onPressed: () => onPick(hub),
          );
        },
      ),
    );
  }
}

class _ScanAction extends StatelessWidget {
  const _ScanAction({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
  });

  final String tooltip;
  final IconData icon;
  final Future<void> Function()? onPressed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6),
      child: Tooltip(
        message: tooltip,
        child: IconButton.filledTonal(
          onPressed: onPressed == null ? null : () => onPressed!(),
          icon: AnimatedSwitcher(
            duration: AppTheme.motionFast,
            transitionBuilder: (child, animation) => ScaleTransition(
              scale: animation,
              child: RotationTransition(turns: animation, child: child),
            ),
            child: Icon(icon, key: ValueKey<IconData>(icon)),
          ),
          style: IconButton.styleFrom(
            backgroundColor: AppTheme.primary.withValues(alpha: 0.2),
            foregroundColor: AppTheme.secondary,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppTheme.radiusM),
            ),
          ),
        ),
      ),
    );
  }
}

class _CameraFailure extends StatelessWidget {
  const _CameraFailure({
    required this.message,
    required this.onOpenSettings,
    required this.onPaste,
  });

  final String message;
  final Future<void> Function() onOpenSettings;
  final VoidCallback onPaste;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: AppTheme.darkSurface,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Icon(Icons.videocam_off_rounded,
                  size: 48, color: AppTheme.warning),
              const SizedBox(height: 12),
              const Text(
                'Camera unavailable on this device.',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 6),
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12, color: AppTheme.darkTextDim),
              ),
              const SizedBox(height: 18),
              GradientActionButton(
                icon: Icons.content_paste_rounded,
                label: 'Paste link instead',
                onTap: onPaste,
              ),
              const SizedBox(height: 6),
              TextButton.icon(
                onPressed: () => onOpenSettings(),
                icon: const Icon(Icons.settings_rounded, size: 18),
                label: const Text('Open settings'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
