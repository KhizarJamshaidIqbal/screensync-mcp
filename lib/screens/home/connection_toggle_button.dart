import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../../core/app_theme.dart';

/// Polished pill button that lives in the app bar and reflects the live
/// connection state:
///  - connected  -> a filled "Live" pill with a pulsing dot; tap disconnects.
///  - disconnected-> a subtle outlined "Connect" pill; tap auto-connects.
///  - [authProblem] -> a danger "Re-pair" pill: the hub answers but rejects
///    this phone's token, so "Connect" could never help; tap re-scans the QR.
class ConnectionToggleButton extends StatelessWidget {
  const ConnectionToggleButton({
    super.key,
    required this.connected,
    required this.busy,
    required this.onDisconnect,
    required this.onConnect,
    this.authProblem = false,
    this.onRepair,
  });

  final bool connected;
  final bool busy;

  /// The hub is reachable but rejected the pairing token (and no live stream
  /// proves otherwise). Takes precedence over [connected].
  final bool authProblem;
  final VoidCallback onDisconnect;
  final VoidCallback onConnect;
  final VoidCallback? onRepair;

  @override
  Widget build(BuildContext context) {
    final Color accent = authProblem
        ? AppTheme.danger
        : (connected ? AppTheme.success : AppTheme.primary);
    final String label = busy
        ? 'Connecting'
        : authProblem
            ? 'Re-pair'
            : connected
                ? 'Live'
                : 'Connect';
    final VoidCallback? onTap = busy
        ? null
        : authProblem
            ? onRepair
            : (connected ? onDisconnect : onConnect);

    return Tooltip(
      message: authProblem
          ? 'The hub rejected this pairing token - scan its QR again'
          : connected
              ? 'Close ScreenSync MCP connection'
              : 'Connect to ScreenSync hub',
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(999),
          onTap: onTap,
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
                else if (authProblem)
                  Icon(Icons.key_off_rounded, size: 13, color: accent)
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
