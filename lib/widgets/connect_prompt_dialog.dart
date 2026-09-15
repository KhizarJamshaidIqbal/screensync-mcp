import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../core/app_theme.dart';
import '../screens/dashboard/detail_cards.dart';

/// The "link this phone to your hub" prompt.
///
/// Shown once after install, and again every time the hub link drops, so a user
/// whose phone has quietly lost its hub gets a one-tap way back. Skipping only
/// silences it until the next drop - a real outage always asks again.
class ConnectPromptDialog extends StatelessWidget {
  const ConnectPromptDialog({super.key});

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 24),
      child: GlassPanel(
        borderColor: AppTheme.primary.withValues(alpha: 0.45),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SectionHeader(
              icon: Icons.qr_code_scanner_rounded,
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF7C3AED), Color(0xFFC13BD9)],
              ),
              title: 'Connect to your hub',
            ),
            const SizedBox(height: 10),
            Text(
              'This phone is not linked to ScreenSync MCP right now. Scan the '
              'QR shown by the hub to pair again - it is on the hub terminal '
              'and on its pairing page.',
              style:
                  AppTheme.typeBodyMedium.copyWith(color: AppTheme.darkTextDim),
            ),
            const SizedBox(height: 16),
            // Scanning is the whole point of the dialog, so it is a large tap
            // target instead of a small button somewhere in a row.
            InkWell(
              borderRadius: BorderRadius.circular(AppTheme.radiusM),
              onTap: () => Navigator.of(context).pop(true),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
                decoration: BoxDecoration(
                  gradient: AppTheme.gradPrimary,
                  borderRadius: BorderRadius.circular(AppTheme.radiusM),
                  boxShadow: [
                    BoxShadow(
                      color: AppTheme.primary.withValues(alpha: 0.35),
                      blurRadius: 14,
                      offset: const Offset(0, 6),
                    ),
                  ],
                ),
                child: const Row(
                  children: [
                    Icon(Icons.qr_code_scanner_rounded,
                        color: Colors.white, size: 24),
                    SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Scan QR code',
                            style: TextStyle(
                                color: Colors.white,
                                fontSize: 15,
                                fontWeight: FontWeight.w700),
                          ),
                          SizedBox(height: 2),
                          Text(
                            'Opens the scanner - no typing needed.',
                            style: TextStyle(
                                color: Colors.white70, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                    Icon(Icons.arrow_forward_rounded,
                        color: Colors.white, size: 18),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 6),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('Skip'),
              ),
            ),
          ],
        ),
      ),
    )
        .animate()
        .fadeIn(duration: 220.ms)
        .scale(begin: const Offset(0.96, 0.96), end: const Offset(1, 1));
  }
}

/// Shows the prompt. Returns true when the user chose to scan.
Future<bool> showConnectPrompt(BuildContext context) async {
  final scan = await showDialog<bool>(
    context: context,
    // The prompt is the only way back from a silent outage, so a stray tap
    // outside must not dismiss it; Skip and Scan are the two exits.
    barrierDismissible: false,
    builder: (_) => const ConnectPromptDialog(),
  );
  return scan == true;
}
