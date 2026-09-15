import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../blocs/screen_capture_bloc.dart';
import '../core/app_theme.dart';
import '../services/settings_service.dart';

/// What the user chose in the connect prompt.
enum ConnectPromptResult {
  /// Open the QR scanner.
  scan,

  /// Reconnect to a hub this phone already paired with.
  recent,

  /// Dismiss for now.
  skip,
}

/// The "link this phone to your hub" prompt.
///
/// Shown once after install, and again every time the hub link drops, so a user
/// whose phone has quietly lost its hub gets a one-tap way back. Skipping only
/// silences it until the next drop - a real outage always asks again.
///
/// Beyond the scan tile it lists the hubs this phone already knows, because
/// re-pairing with a hub you have used before should not need the QR again.
class ConnectPromptDialog extends StatefulWidget {
  const ConnectPromptDialog({
    super.key,
    this.hubUrl = '',
    this.online = false,
  });

  /// Last known hub address, shown in the status strip.
  final String hubUrl;

  /// Whether the hub answered on the last check.
  final bool online;

  @override
  State<ConnectPromptDialog> createState() => _ConnectPromptDialogState();
}

class _ConnectPromptDialogState extends State<ConnectPromptDialog> {
  late final List<({String url, String token})> _recent =
      SettingsService.instance.recentHubs;

  /// Hand the saved hub straight to the bloc, so a reconnect needs no typing and
  /// no camera - the fastest path back from a dropped link.
  void _useRecent(({String url, String token}) hub) {
    SettingsService.instance
      ..hubUrlOverride = hub.url
      ..pairingToken = hub.token;
    context.read<ScreenCaptureBloc>()
      ..add(SetHubUrlEvent(hub.url))
      ..add(SetPairingTokenEvent(hub.token));
    Navigator.of(context).pop(ConnectPromptResult.recent);
  }

  String _shortHost(String url) {
    final cleaned = url.replaceFirst(RegExp(r'^https?://'), '');
    return cleaned.isEmpty ? 'hub' : cleaned.replaceAll(RegExp(r'/+$'), '');
  }

  @override
  Widget build(BuildContext context) {
    final showRecent = _recent.take(3).toList();
    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 20),
      child: GlassPanel(
        borderColor: AppTheme.primary.withValues(alpha: 0.45),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ---- header: gradient tile, title, and the top-right skip ----
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [Color(0xFF7C3AED), Color(0xFFC13BD9)],
                    ),
                    borderRadius: BorderRadius.circular(AppTheme.radiusM),
                    boxShadow: [
                      BoxShadow(
                        color: AppTheme.primary.withValues(alpha: 0.35),
                        blurRadius: 14,
                        offset: const Offset(0, 6),
                      ),
                    ],
                  ),
                  child: const Icon(Icons.qr_code_scanner_rounded,
                      color: Colors.white, size: 21),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Connect your hub',
                          style: AppTheme.typeTitleMedium.copyWith(
                              fontSize: 17, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 2),
                      Text(
                        widget.online
                            ? 'Linked, but not streaming right now'
                            : 'This phone is not linked right now',
                        style: AppTheme.typeCaption
                            .copyWith(color: AppTheme.darkTextDim),
                      ),
                    ],
                  ),
                ),
                // Skip lives top-right, where a close control belongs.
                IconButton(
                  tooltip: 'Skip',
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.close_rounded,
                      size: 20, color: AppTheme.darkTextDim),
                  onPressed: () =>
                      Navigator.of(context).pop(ConnectPromptResult.skip),
                ),
              ],
            ),
            const SizedBox(height: 10),

            // ---- live status strip: says what is actually wrong ----
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(
                color: (widget.online ? AppTheme.warning : AppTheme.danger)
                    .withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(AppTheme.radiusM),
                border: Border.all(
                  color: (widget.online ? AppTheme.warning : AppTheme.danger)
                      .withValues(alpha: 0.30),
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    widget.online
                        ? Icons.sync_problem_rounded
                        : Icons.link_off_rounded,
                    size: 16,
                    color:
                        widget.online ? AppTheme.warning : AppTheme.danger,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      widget.hubUrl.isEmpty
                          ? 'No hub address saved on this phone yet.'
                          : 'Last hub: ${_shortHost(widget.hubUrl)}',
                      style: AppTheme.typeCaption.copyWith(
                          color: AppTheme.darkTextDim,
                          fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),

            // ---- primary action: scan ----
            InkWell(
              borderRadius: BorderRadius.circular(AppTheme.radiusM),
              onTap: () => Navigator.of(context).pop(ConnectPromptResult.scan),
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
                          Text('Scan QR code',
                              style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 15,
                                  fontWeight: FontWeight.w700)),
                          SizedBox(height: 2),
                          Text('Opens the scanner - no typing needed.',
                              style: TextStyle(
                                  color: Colors.white70, fontSize: 12)),
                        ],
                      ),
                    ),
                    Icon(Icons.arrow_forward_rounded,
                        color: Colors.white, size: 18),
                  ],
                ),
              ),
            )
                .animate(onPlay: (c) => c.repeat(reverse: true))
                .custom(
                  duration: 1900.ms,
                  builder: (context, value, child) => Transform.scale(
                    scale: 1 + 0.012 * value,
                    child: child,
                  ),
                ),

            // ---- advanced: one-tap reconnect to a hub you already paired ----
            if (showRecent.isNotEmpty) ...[
              const SizedBox(height: 16),
              Row(
                children: [
                  const Icon(Icons.history_rounded,
                      size: 14, color: AppTheme.darkTextDim),
                  const SizedBox(width: 6),
                  Text('Reconnect instantly',
                      style: AppTheme.microLabel
                          .copyWith(color: AppTheme.darkTextDim)),
                ],
              ),
              const SizedBox(height: 8),
              for (final hub in showRecent)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(AppTheme.radiusM),
                    onTap: () => _useRecent(hub),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.04),
                        borderRadius: BorderRadius.circular(AppTheme.radiusM),
                        border: Border.all(
                          color: AppTheme.primary.withValues(alpha: 0.25),
                        ),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.lan_rounded,
                              size: 15, color: AppTheme.primary),
                          const SizedBox(width: 9),
                          Expanded(
                            child: Text(
                              _shortHost(hub.url),
                              overflow: TextOverflow.ellipsis,
                              style: AppTheme.typeBodyMedium.copyWith(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600),
                            ),
                          ),
                          const Icon(Icons.bolt_rounded,
                              size: 16, color: AppTheme.success),
                        ],
                      ),
                    ),
                  ),
                ),
            ],

            const SizedBox(height: 10),
            Text(
              'You can pair any time from Settings, Hub connection.',
              style: AppTheme.typeCaption.copyWith(color: AppTheme.darkTextDim),
            ),
          ],
        ),
      ),
    )
        .animate()
        .fadeIn(duration: 220.ms)
        .scale(begin: const Offset(0.96, 0.96), end: const Offset(1, 1))
        .slideY(begin: 0.04, end: 0);
  }
}

/// Shows the prompt. Returns what the user chose.
Future<ConnectPromptResult> showConnectPrompt(
  BuildContext context, {
  String hubUrl = '',
  bool online = false,
}) async {
  final result = await showDialog<ConnectPromptResult>(
    context: context,
    // The prompt is the only way back from a silent outage, so a stray tap
    // outside must not dismiss it; Scan, a recent hub and Skip are the exits.
    barrierDismissible: false,
    builder: (_) => ConnectPromptDialog(hubUrl: hubUrl, online: online),
  );
  return result ?? ConnectPromptResult.skip;
}
