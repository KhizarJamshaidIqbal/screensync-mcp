import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../blocs/screen_capture_bloc.dart';
import '../core/app_theme.dart';
import '../services/pairing_service.dart';
import '../services/settings_service.dart';
import '../widgets/app_dialog.dart';
import '../widgets/ref_widgets.dart';

/// Scans the desktop hub's pairing QR (terminal print or /pair page) and
/// applies hub URL + token with zero typing. A paste-link fallback covers
/// devices without a usable camera (e.g. emulator virtual camera).
class PairScanScreen extends StatefulWidget {
  const PairScanScreen({super.key});

  @override
  State<PairScanScreen> createState() => _PairScanScreenState();
}

class _PairScanScreenState extends State<PairScanScreen> {
  final MobileScannerController _controller = MobileScannerController();
  final TextEditingController _pasteController = TextEditingController();
  bool _handled = false;

  @override
  void dispose() {
    _controller.dispose();
    _pasteController.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_handled) return;
    for (final barcode in capture.barcodes) {
      final info = PairingService.parse(barcode.rawValue ?? '');
      if (info != null) {
        _handled = true;
        _apply(info);
        return;
      }
    }
  }

  void _apply(PairingInfo info) {
    SettingsService.instance
      ..hubUrlOverride = info.url
      ..pairingToken = info.token;
    context
        .read<ScreenCaptureBloc>()
      ..add(SetHubUrlEvent(info.url))
      ..add(SetPairingTokenEvent(info.token))
      ..add(PingHubEvent());
    final messenger = ScaffoldMessenger.of(context);
    Navigator.of(context).pop(true);
    messenger.showSnackBar(SnackBar(
      content: Text('Paired with ${info.url}'),
      backgroundColor: AppTheme.success,
    ));
  }

  void _openPasteDialog() {
    _pasteController.clear();
    String? error;
    // Rebuilds only the field (for inline validation) without recreating the
    // whole shared dialog shell.
    final errorNotifier = ValueNotifier<String?>(null);

    void submit(BuildContext dialogContext) {
      final info = PairingService.parse(_pasteController.text);
      if (info == null) {
        error = 'Not a valid pairing link or hub URL.';
        errorNotifier.value = error;
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
        builder: (context, err, _) => TextField(
          controller: _pasteController,
          maxLines: 3,
          autofocus: true,
          onSubmitted: (_) => submit(context),
          decoration: InputDecoration(
            isDense: true,
            hintText: 'screensync://pair?url=…&token=…',
            errorText: err,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppTheme.radiusS),
            ),
          ),
        ),
      ),
      actions: [
        AppDialogAction(
          label: 'Cancel',
          onPressed: () =>
              Navigator.of(context, rootNavigator: true).pop(),
        ),
        AppDialogAction(
          label: 'Pair',
          primary: true,
          onPressed: () => submit(context),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Pair with desktop')),
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
            errorBuilder: (context, error) => Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.videocam_off_rounded,
                          size: 48, color: AppTheme.warning),
                      const SizedBox(height: 12),
                      const Text(
                        'Camera unavailable on this device.',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        error.errorDetails?.message ??
                            'Use "Paste link instead" below to pair manually.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                            fontSize: 12, color: AppTheme.darkTextDim),
                      ),
                    ]),
              ),
            ),
          ),
          // Viewfinder cutout hint.
          Center(
            child: Container(
              width: 240,
              height: 240,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(AppTheme.radiusL),
                border: Border.all(
                    color: AppTheme.primary.withValues(alpha: 0.9),
                    width: 2.5),
                boxShadow: [
                  BoxShadow(
                    color: AppTheme.primary.withValues(alpha: 0.35),
                    blurRadius: 18,
                    spreadRadius: 2,
                  ),
                ],
              ),
            ),
          ),
          const Positioned(
            top: 24,
            left: 0,
            right: 0,
            child: Center(
              child: Text(
                'Point at the QR shown by the desktop hub',
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                    shadows: [Shadow(blurRadius: 8)]),
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
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    IconButton.filledTonal(
                      style: IconButton.styleFrom(
                        backgroundColor:
                            AppTheme.primary.withValues(alpha: 0.2),
                        foregroundColor: AppTheme.secondary,
                        shape: RoundedRectangleBorder(
                            borderRadius:
                                BorderRadius.circular(AppTheme.radiusM)),
                      ),
                      onPressed: () => _controller.toggleTorch(),
                      icon: ValueListenableBuilder(
                        valueListenable: _controller,
                        builder: (_, value, __) => Icon(
                          value.torchState == TorchState.on
                              ? Icons.flash_on_rounded
                              : Icons.flash_off_rounded,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: GradientActionButton(
                        icon: Icons.content_paste_rounded,
                        label: 'Paste link instead',
                        onTap: _openPasteDialog,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
