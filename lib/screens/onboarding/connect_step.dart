import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';
import '../../widgets/common_widgets.dart';
import '../../widgets/ref_widgets.dart';
import '../pair_scan_screen.dart';
import 'step_shell.dart';

/// Step 2: connect to the desktop hub via QR scan, auto-discovery or a
/// pasted pairing link.
class ConnectStep extends StatelessWidget {
  const ConnectStep({
    super.key,
    required this.pairController,
    this.pairStatus,
    required this.pairOk,
    required this.onApplyPairing,
    required this.onQrPaired,
    required this.onNext,
  });

  final TextEditingController pairController;
  final String? pairStatus;
  final bool pairOk;
  final VoidCallback onApplyPairing;
  final VoidCallback onQrPaired;
  final VoidCallback onNext;

  Future<void> _scanQr(BuildContext context) async {
    final paired = await Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const PairScanScreen()));
    if (paired == true) onQrPaired();
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ScreenCaptureBloc, ScreenCaptureState>(
      builder: (context, state) {
        final online = state.hubOnline == true;
        return StepShell(
          icon: Icons.link_rounded,
          title: 'Connect your desktop',
          subtitle:
              'Start the ScreenSync hub on your PC (double-click start-hub), then scan its QR — or let auto-discovery find it, or paste the pairing link.',
          children: [
            GlassPanel(
              borderColor: online
                  ? AppTheme.success.withValues(alpha: 0.5)
                  : null,
              child: Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: (online
                              ? AppTheme.success
                              : AppTheme.primary)
                          .withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(
                      online
                          ? Icons.check_circle_rounded
                          : Icons.wifi_find_rounded,
                      color: online
                          ? AppTheme.success
                          : AppTheme.primary,
                      size: 20,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      online
                          ? 'Connected! Your desktop can see this phone.'
                          : (state.discovering
                              ? 'Scanning your Wi-Fi for the hub…'
                              : 'Not connected yet.'),
                      style: const TextStyle(
                          fontSize: 13, fontWeight: FontWeight.w600),
                    ),
                  ),
                  if (!online)
                    TextButton(
                      onPressed: state.discovering
                          ? null
                          : () => context
                              .read<ScreenCaptureBloc>()
                              .add(AutoConnectHubEvent()),
                      child: Text(state.discovering ? '…' : 'Auto-find',
                          style:
                              const TextStyle(color: AppTheme.primary)),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            GradientActionButton(
              icon: Icons.qr_code_scanner_rounded,
              label: 'Scan QR code',
              onTap: () => _scanQr(context),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: pairController,
              maxLines: 2,
              minLines: 1,
              style: const TextStyle(fontSize: 12.5, fontFamily: 'monospace'),
              decoration: InputDecoration(
                border: const OutlineInputBorder(),
                labelText: 'Pairing link (screensync://pair?…)',
                isDense: true,
                suffixIcon: IconButton(
                  icon: const Icon(Icons.arrow_forward_rounded),
                  onPressed: onApplyPairing,
                ),
              ),
              onSubmitted: (_) => onApplyPairing(),
            ),
            if (pairStatus != null) ...[
              const SizedBox(height: 8),
              Text(
                pairStatus!,
                style: TextStyle(
                  fontSize: 12,
                  color: pairOk ? AppTheme.success : AppTheme.danger,
                ),
              ),
            ],
          ],
          cta: Column(
            children: [
              GradientActionButton(
                icon: Icons.arrow_forward_rounded,
                label: online ? 'Continue' : 'Continue anyway',
                onTap: onNext,
              ),
              const SizedBox(height: 8),
              Text('You can connect later from Settings → Hub.',
                  style: AppTheme.typeCaption
                      .copyWith(color: AppTheme.darkTextDim)),
            ],
          ),
        );
      },
    );
  }
}
