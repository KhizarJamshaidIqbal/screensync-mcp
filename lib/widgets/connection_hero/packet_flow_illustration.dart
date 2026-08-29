import 'dart:async';
import 'dart:io' as dart_io;
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:sensors_plus/sensors_plus.dart';

import '../../blocs/screen_capture_bloc.dart';
import '../../core/app_theme.dart';

/// Animated packet-flow illustration ("Live Bridge").
///
/// Upgrades over the original static line:
///  - Breathing / glowing AI orb with one-shot ripple pulses on new activity.
///  - Packet colour reacts to latency band (green/amber/red) as well as speed.
///  - Faint reverse-direction packets (AI → phone) → reads as a two-way link.
///  - Subtle reactive waveform accent behind the packet line.
///  - Long-press the AI orb → quick AI actions (wired to real bloc events).
///  - Camera-flash micro-animation on the orb when a capture/frame event fires.
///  - Tasteful parallax offset on device tilt (accelerometer, graceful no-op).
class PacketFlowIllustration extends StatefulWidget {
  const PacketFlowIllustration({
    super.key,
    required this.online,
    required this.latencyMs,
    this.activityPulseKey,
    this.flashPulseKey,
    this.jitter,
    this.latestFramePath,
    this.deviceName,
    this.agentName,
  });

  final bool online;
  final int? latencyMs;

  /// Bumps whenever a new activity event/frame arrives → triggers a ripple.
  final Object? activityPulseKey;

  /// Bumps whenever a capture/frame (screenshot) event fires → camera flash.
  final Object? flashPulseKey;

  /// Recent latency jitter — drives waveform amplitude. Null → calm line.
  final int? jitter;

  /// Path to the latest captured frame PNG. When non-null and the file
  /// exists, the phone mock shows the real screenshot instead of the
  /// purple-gradient placeholder.
  final String? latestFramePath;

  /// Android device model (e.g. "Pixel 7") — replaces "This phone" label.
  final String? deviceName;

  /// Connected AI agent name (e.g. "Claude Desktop") — replaces "Your AI" label.
  final String? agentName;

  @override
  State<PacketFlowIllustration> createState() => _PacketFlowIllustrationState();
}

class _PacketFlowIllustrationState extends State<PacketFlowIllustration>
    with TickerProviderStateMixin {
  late final AnimationController _controller; // packet travel
  late final AnimationController _breathe; // orb breathing
  late final AnimationController _ripple; // one-shot ripple
  late final AnimationController _flash; // camera flash

  StreamSubscription<UserAccelerometerEvent>? _accelSub;
  double _tiltX = 0, _tiltY = 0;

  static const _packetPhases = <double>[0.0, 0.22, 0.44, 0.66, 0.88];
  static const _reversePhases = <double>[0.12, 0.55, 0.83];

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: _cycleDurationFor(widget.latencyMs),
    )..repeat();
    _breathe = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2600),
    )..repeat(reverse: true);
    _ripple = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );
    _flash = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 520),
    );
    _initSensors();
  }

  void _initSensors() {
    try {
      // Use USER acceleration (gravity removed) so a phone at rest yields
      // ~0 tilt. Raw accelerometer reports constant gravity (~9.8 on the
      // resting axis), which would permanently offset the orb/label and push
      // the caption into the metrics ribbon below. userAccelerometer is ~0 at
      // rest and only responds to actual movement — the intended parallax.
      _accelSub = userAccelerometerEventStream().listen(
        (e) {
          if (!mounted) return;
          // Small, clamped parallax. Low-pass filter for smoothness.
          setState(() {
            _tiltX = (_tiltX * 0.85 + (e.x.clamp(-4.0, 4.0) / 4.0) * 4) * 1;
            _tiltY = (_tiltY * 0.85 + (e.y.clamp(-4.0, 4.0) / 4.0) * 4) * 1;
          });
        },
        onError: (_) {},
        cancelOnError: true,
      );
    } catch (_) {
      // Desktop/emulator without sensors → no-op.
    }
  }

  @override
  void didUpdateWidget(covariant PacketFlowIllustration oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.latencyMs != widget.latencyMs && widget.online) {
      _controller.duration = _cycleDurationFor(widget.latencyMs);
    }
    if (oldWidget.activityPulseKey != widget.activityPulseKey &&
        widget.activityPulseKey != null) {
      _ripple.forward(from: 0);
    }
    if (oldWidget.flashPulseKey != widget.flashPulseKey &&
        widget.flashPulseKey != null) {
      _flash.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _accelSub?.cancel();
    _controller.dispose();
    _breathe.dispose();
    _ripple.dispose();
    _flash.dispose();
    super.dispose();
  }

  Duration _cycleDurationFor(int? ms) {
    if (!widget.online || ms == null) {
      return const Duration(milliseconds: 2400);
    }
    if (ms < 50) return const Duration(milliseconds: 700);
    if (ms < 150) return const Duration(milliseconds: 1100);
    if (ms < 400) return const Duration(milliseconds: 1700);
    return const Duration(milliseconds: 2600);
  }

  /// Reactive packet colour by latency band.
  Color _packetColor() {
    if (!widget.online) return AppTheme.danger;
    final ms = widget.latencyMs;
    if (ms == null) return AppTheme.primary;
    if (ms < 100) return AppTheme.success;
    if (ms <= 250) return AppTheme.warning;
    return AppTheme.danger;
  }

  void _showOrbMenu(Offset globalPos) {
    final bloc = context.read<ScreenCaptureBloc>();
    final overlay =
        Overlay.of(context).context.findRenderObject() as RenderBox?;
    if (overlay == null) return;
    showMenu<String>(
      context: context,
      position: RelativeRect.fromLTRB(
        globalPos.dx,
        globalPos.dy,
        overlay.size.width - globalPos.dx,
        overlay.size.height - globalPos.dy,
      ),
      items: const [
        PopupMenuItem(
          value: 'capture',
          child: Row(children: [
            Icon(Icons.camera_alt_rounded, size: 16),
            SizedBox(width: 8),
            Text('Capture now'),
          ]),
        ),
        PopupMenuItem(
          value: 'sync',
          child: Row(children: [
            Icon(Icons.cloud_sync_rounded, size: 16),
            SizedBox(width: 8),
            Text('Sync pending'),
          ]),
        ),
        PopupMenuItem(
          value: 'ping',
          child: Row(children: [
            Icon(Icons.wifi_tethering_rounded, size: 16),
            SizedBox(width: 8),
            Text('Ping hub'),
          ]),
        ),
      ],
    ).then((v) {
      if (v == null || !mounted) return;
      switch (v) {
        case 'capture':
          bloc.add(QuickCaptureRequestedEvent());
        case 'sync':
          bloc.add(QuickSyncRequestedEvent());
        case 'ping':
          bloc.add(QuickPingRequestedEvent());
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    final accent = _packetColor();
    // Side columns are as wide as their captions (long device models), so the
    // cable's column starts/ends away from the phone's and orb's visual edges.
    // Extend the painted cable by exactly that overflow so it still meets the
    // phone's right edge and tucks into the orb (72px slot, 56px orb → 8px
    // inset + 2px tuck) on the right.
    final leftExt = _captionOverflow(widget.deviceName ?? 'This phone', 44) + 2;
    const rightExt = 10.0;
    // Reserve a fixed height so the tallest column (phone/orb + caption) never
    // bleeds into the metrics ribbon below, even with the ±4px tilt parallax.
    return SizedBox(
      height: 110,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
        Transform.translate(
          offset: Offset(-_tiltX, -_tiltY),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Semantics(
                label: 'Phone screen — live capture preview',
                child: _PhoneMock(
                  online: widget.online,
                  latestFramePath: widget.latestFramePath,
                ),
              ),
              const SizedBox(height: 8),
              MicroLabelCompact(
                widget.deviceName ?? 'This phone',
              ),
            ],
          ),
        ),
        Expanded(
          // Bottom-anchored Stack: the row is a fixed 110px tall with the side
          // columns bottom-aligned, so icon centers are stable from the bottom
          // (phone ≈ captionH+40, orb ≈ captionH+44). Cable center lands at
          // captionH+42 → passes through both icons; the latency pill hovers
          // 4dp above the cable's center instead of floating at the top.
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Positioned(
                left: 0,
                right: 0,
                bottom: _captionHeight() + 32,
                child: SizedBox(
                  height: 20,
                  child: AnimatedBuilder(
                    animation: _controller,
                    builder: (_, __) => CustomPaint(
                      painter: _PacketFlowPainter(
                        progress: _controller.value,
                        phases: _packetPhases,
                        reversePhases: _reversePhases,
                        color: accent,
                        active: widget.online,
                        leftExt: leftExt,
                        rightExt: rightExt,
                        waveAmp: reduceMotion
                            ? 0
                            : _waveAmpFor(widget.jitter),
                      ),
                      child: const SizedBox.expand(),
                    ),
                  ),
                ),
              ),
              if (widget.online && widget.latencyMs != null)
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: _captionHeight() + 46,
                  child: Center(
                    child: _LatencyPill(latencyMs: widget.latencyMs!),
                  ),
                ),
            ],
          ),
        ),
        Transform.translate(
          offset: Offset(_tiltX, _tiltY),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Semantics(
                button: true,
                label: '${widget.agentName ?? "Your AI"}. Long-press for quick actions.',
                child: Tooltip(
                  message: 'Long-press for AI actions',
                  child: GestureDetector(
                    onLongPressStart: (d) {
                      HapticFeedback.selectionClick();
                      _showOrbMenu(d.globalPosition);
                    },
                    child: _BreathingOrb(
                      active: widget.online,
                      breathe: _breathe,
                      ripple: _ripple,
                      flash: _flash,
                      reduceMotion: reduceMotion,
                      accent: accent,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              // Caption shares the orb's 72px slot so a long agent name can't
              // widen this column and drift the caption off the orb's center.
              SizedBox(
                width: 72,
                child: Center(
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    child: MicroLabelCompact(widget.agentName ?? 'Your AI'),
                  ),
                ),
              ),
            ],
          ),
        ),
        ],
      ),
    );
  }

  double _waveAmpFor(int? jitter) {
    if (!widget.online || jitter == null) return 0;
    return (jitter / 120).clamp(0.0, 1.0) * 4.5;
  }

  double _captionOverflow(String text, double slotWidth) {
    final tp = TextPainter(
      text: TextSpan(text: text.toUpperCase(), style: AppTheme.microLabel),
      textDirection: TextDirection.ltr,
    )..layout();
    return math.max(0.0, (tp.width - slotWidth) / 2);
  }

  double _captionHeight() {
    final tp = TextPainter(
      text: const TextSpan(text: 'A', style: AppTheme.microLabel),
      textDirection: TextDirection.ltr,
    )..layout();
    return tp.height;
  }
}

class _PhoneMock extends StatelessWidget {
  const _PhoneMock({required this.online, this.latestFramePath});
  final bool online;
  final String? latestFramePath;

  bool get _hasFrame =>
      latestFramePath != null && dart_io.File(latestFramePath!).existsSync();

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      width: 44,
      height: 64,
      decoration: BoxDecoration(
        color: dark ? const Color(0xFF2E2150) : const Color(0xFFE6DEF6),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
            color: AppTheme.primary.withValues(alpha: 0.35), width: 1.5),
        boxShadow: AppTheme.elevLow,
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(8.5),
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 400),
          switchInCurve: Curves.easeOut,
          switchOutCurve: Curves.easeIn,
          child: _hasFrame
              ? Image.file(
                  dart_io.File(latestFramePath!),
                  key: ValueKey('frame_$latestFramePath'),
                  width: 44,
                  height: 64,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => _PlaceholderScreen(online: online),
                )
              : _PlaceholderScreen(key: const ValueKey('placeholder'), online: online),
        ),
      ),
    );
  }
}

/// Purple-gradient placeholder shown when no live frame is available.
class _PlaceholderScreen extends StatelessWidget {
  const _PlaceholderScreen({super.key, required this.online});
  final bool online;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 44,
      height: 64,
      decoration: BoxDecoration(
        gradient: online
            ? AppTheme.gradOrb
            : const LinearGradient(
                colors: [Color(0xFFB9B3CC), Color(0xFF9C94BC)]),
        borderRadius: BorderRadius.circular(5),
      ),
      child: const Center(
        child: SizedBox(
          width: 26,
          height: 40,
        ),
      ),
    );
  }
}

/// Breathing AI orb with ripple + camera-flash overlays.
class _BreathingOrb extends StatelessWidget {
  const _BreathingOrb({
    required this.active,
    required this.breathe,
    required this.ripple,
    required this.flash,
    required this.reduceMotion,
    required this.accent,
  });

  final bool active;
  final AnimationController breathe;
  final AnimationController ripple;
  final AnimationController flash;
  final bool reduceMotion;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 72,
      height: 72,
      child: AnimatedBuilder(
        animation: Listenable.merge([breathe, ripple, flash]),
        builder: (context, _) {
          final b = reduceMotion ? 0.5 : breathe.value; // 0..1
          final double glowBlur = 16 + (active ? b * 12 : 0.0);
          final double scale = active && !reduceMotion ? 1 + b * 0.04 : 1.0;
          final baseColor = active ? AppTheme.primary : const Color(0xFF6B6485);
          return Stack(
            alignment: Alignment.center,
            children: [
              // One-shot ripple.
              if (ripple.isAnimating || ripple.value > 0)
                Container(
                  width: 40 + ripple.value * 34,
                  height: 40 + ripple.value * 34,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: accent.withValues(
                          alpha: (1 - ripple.value).clamp(0.0, 1.0) * 0.6),
                      width: 2,
                    ),
                  ),
                ),
              // The orb.
              Transform.scale(
                scale: scale,
                child: Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(
                    gradient: active
                        ? AppTheme.gradOrb
                        : const LinearGradient(
                            colors: [Color(0xFF8A85A3), Color(0xFF6B6485)]),
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: baseColor.withValues(alpha: 0.55),
                        blurRadius: glowBlur,
                        spreadRadius: 2,
                      ),
                    ],
                  ),
                  child: const Center(
                    child: Icon(Icons.auto_awesome_rounded,
                        color: Colors.white, size: 20),
                  ),
                ),
              ),
              // Camera-flash / eye-blink overlay.
              if (flash.value > 0)
                Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: Colors.white.withValues(
                      alpha: (math.sin(flash.value * math.pi)).clamp(0.0, 1.0) *
                          0.85,
                    ),
                  ),
                  child: Icon(
                    Icons.remove_red_eye_rounded,
                    size: 20,
                    color: AppTheme.primary.withValues(
                      alpha: (math.sin(flash.value * math.pi)).clamp(0.0, 1.0),
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _LatencyPill extends StatelessWidget {
  const _LatencyPill({required this.latencyMs});
  final int latencyMs;

  @override
  Widget build(BuildContext context) {
    final color = latencyMs < 100
        ? AppTheme.success
        : (latencyMs < 300 ? AppTheme.primary : AppTheme.warning);
    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.circle, size: 5, color: color),
          const SizedBox(width: 4),
          Text(
            '$latencyMs ms',
            style: AppTheme.microLabel.copyWith(color: color),
          ),
        ],
      ),
    );
  }
}

class MicroLabelCompact extends StatelessWidget {
  const MicroLabelCompact(this.text, {super.key, this.color});
  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style:
          AppTheme.microLabel.copyWith(color: color ?? AppTheme.darkTextDim),
    );
  }
}

class _PacketFlowPainter extends CustomPainter {
  _PacketFlowPainter({
    required this.progress,
    required this.phases,
    required this.reversePhases,
    required this.color,
    required this.active,
    required this.leftExt,
    required this.rightExt,
    required this.waveAmp,
  });

  final double progress; // 0..1
  final List<double> phases;
  final List<double> reversePhases;
  final Color color;
  final bool active;
  final double leftExt;
  final double rightExt;
  final double waveAmp;

  @override
  void paint(Canvas canvas, Size size) {
    final y = size.height / 2;
    // Negative pads extend the cable past this column so it meets the phone's
    // right edge and the orb's visual left edge (side columns are widened by
    // their captions; see build()).
    final leftPad = -leftExt;
    final rightPad = -rightExt;
    final usableW = size.width - leftPad - rightPad;

    // Reactive waveform accent behind the line.
    if (active && waveAmp > 0.1) {
      final wavePaint = Paint()
        ..color = color.withValues(alpha: 0.22)
        ..strokeWidth = 1.0
        ..style = PaintingStyle.stroke;
      final path = Path();
      const steps = 40;
      for (var i = 0; i <= steps; i++) {
        final t = i / steps;
        final x = leftPad + t * usableW;
        final phase = t * 4 * math.pi + progress * 2 * math.pi;
        final yy = y + math.sin(phase) * waveAmp;
        if (i == 0) {
          path.moveTo(x, yy);
        } else {
          path.lineTo(x, yy);
        }
      }
      canvas.drawPath(path, wavePaint);
    }

    // Background dashed line (the "cable").
    final linePaint = Paint()
      ..color = color.withValues(alpha: active ? 0.35 : 0.4)
      ..strokeWidth = 1.5
      ..strokeCap = StrokeCap.round;
    const dash = 4.0, gap = 4.0;
    double x = leftPad;
    while (x < size.width - rightPad) {
      final end = (x + dash).clamp(0.0, size.width - rightPad);
      canvas.drawLine(Offset(x, y), Offset(end, y), linePaint);
      x = end + gap;
    }

    if (!active) {
      final cross = Paint()
        ..color = color
        ..strokeWidth = 2.4
        ..strokeCap = StrokeCap.round;
      final cx = leftPad + usableW / 2;
      canvas.drawLine(Offset(cx - 4, y - 4), Offset(cx + 4, y + 4), cross);
      canvas.drawLine(Offset(cx + 4, y - 4), Offset(cx - 4, y + 4), cross);
      return;
    }

    // Forward packets (phone → AI).
    for (final phase in phases) {
      final t = (progress + phase) % 1.0;
      final px = leftPad + t * usableW;
      final alpha = _edgeFade(t);
      canvas.drawCircle(Offset(px, y), 5.5,
          Paint()..color = color.withValues(alpha: 0.25 * alpha));
      canvas.drawCircle(Offset(px, y), 2.6,
          Paint()..color = color.withValues(alpha: 0.95 * alpha));
    }

    // Reverse packets (AI → phone), fainter & offset above the line.
    final ry = y - 3.5;
    for (final phase in reversePhases) {
      final t = (progress + phase) % 1.0;
      final px = leftPad + (1 - t) * usableW; // travels right→left
      final alpha = _edgeFade(t);
      canvas.drawCircle(Offset(px, ry), 3.4,
          Paint()..color = color.withValues(alpha: 0.14 * alpha));
      canvas.drawCircle(Offset(px, ry), 1.6,
          Paint()..color = color.withValues(alpha: 0.45 * alpha));
    }
  }

  double _edgeFade(double t) => (t < 0.1)
      ? (t / 0.1).clamp(0.0, 1.0)
      : (t > 0.9 ? (1 - (t - 0.9) / 0.1).clamp(0.0, 1.0) : 1.0);

  @override
  bool shouldRepaint(covariant _PacketFlowPainter old) =>
      old.progress != progress ||
      old.color != color ||
      old.active != active ||
      old.leftExt != leftExt ||
      old.rightExt != rightExt ||
      old.waveAmp != waveAmp;
}
