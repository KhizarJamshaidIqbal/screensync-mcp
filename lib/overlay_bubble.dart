import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'services/capture_trigger_bridge.dart';
import 'services/floating_overlay_service.dart';

/// Overlay engine UI. Tap = full capture; long-press = region select
/// (captures the full frame, then the main app opens a full-screen crop
/// editor — see [_enterSelector] for why we no longer resize this window).
class OverlayBubbleWidget extends StatefulWidget {
  const OverlayBubbleWidget({super.key});

  @override
  State<OverlayBubbleWidget> createState() => _OverlayBubbleWidgetState();
}

class _OverlayBubbleWidgetState extends State<OverlayBubbleWidget>
    with WidgetsBindingObserver, SingleTickerProviderStateMixin {
  bool _isCapturing = false;
  bool _flash = false;
  bool _success = false;
  String? _peekPath;
  int _todayCount = 0;
  int _rippleKey = 0;

  late final AnimationController _glow = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1600),
  )..repeat(reverse: true);

  static const _kCountDay = 'bubble_count_day';
  static const _kCount = 'bubble_count';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    CaptureTriggerBridge.configure();
    _loadCount();
    _maybeNormalizeWindow();
  }

  @override
  void dispose() {
    _glow.dispose();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// The overlay isolate boots when the plugin attaches to the activity,
  /// before the overlay service exists; the window (and its resize handler)
  /// only appear when the service starts. View metrics change exactly then,
  /// so that is the right moment to fix the plugin's raw-pixel window size.
  @override
  void didChangeMetrics() => _maybeNormalizeWindow();

  void _maybeNormalizeWindow() {
    final views = WidgetsBinding.instance.platformDispatcher.views;
    if (views.isEmpty || views.first.physicalSize.isEmpty) return;
    FloatingOverlayService.normalizeBubbleWindow();
  }

  Future<void> _loadCount() async {
    final prefs = await SharedPreferences.getInstance();
    final today = DateTime.now().toIso8601String().substring(0, 10);
    final count =
        prefs.getString(_kCountDay) == today ? prefs.getInt(_kCount) ?? 0 : 0;
    if (mounted) setState(() => _todayCount = count);
  }

  Future<void> _bumpCount() async {
    final prefs = await SharedPreferences.getInstance();
    final today = DateTime.now().toIso8601String().substring(0, 10);
    final next =
        (prefs.getString(_kCountDay) == today ? prefs.getInt(_kCount) ?? 0 : 0) +
            1;
    await prefs.setString(_kCountDay, today);
    await prefs.setInt(_kCount, next);
    if (mounted) setState(() => _todayCount = next);
  }

  Future<void> _handleTap() async {
    if (_isCapturing) return;
    HapticFeedback.mediumImpact();
    _bumpCount();
    setState(() {
      _isCapturing = true;
      _flash = true;
      _rippleKey++;
    });
    await Future<void>.delayed(const Duration(milliseconds: 150));
    if (mounted) setState(() => _flash = false);
    // NOTE: do NOT await FlutterOverlayWindow.shareData() here. With two
    // Flutter engines the plugin's messenger relay ping-pongs messages
    // between engines (WindowSetup.messenger is a shared static), so the
    // send future never completes and the tap handler would hang forever,
    // leaving the bubble stuck in its capturing state. The filesystem
    // bridge below is the reliable trigger channel.
    await CaptureTriggerBridge.sendCapture();
    await Future<void>.delayed(const Duration(milliseconds: 500));
    if (!mounted) return;
    setState(() {
      _isCapturing = false;
      _success = true;
    });
    _showPeek();
    await Future<void>.delayed(const Duration(milliseconds: 800));
    if (mounted) setState(() => _success = false);
  }

  /// Briefly shows the just-captured frame under the bubble as proof the
  /// capture worked (the overlay engine reads the shared pointer file).
  Future<void> _showPeek() async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
    final path = await CaptureTriggerBridge.readLatestFramePointer();
    if (path == null || !File(path).existsSync()) return;
    if (!mounted) return;
    setState(() => _peekPath = path);
    await Future<void>.delayed(const Duration(milliseconds: 1500));
    if (mounted) setState(() => _peekPath = null);
  }

  /// Long-press = region select. New reliable design: instead of resizing
  /// this restricted overlay window to full-screen (which Android 12+ / MIUI
  /// / HyperOS clamp — the old approach silently failed or crammed the
  /// selector into the 96dp bubble → "BOTTOM OVERFLOWED BY 196 PIXELS"), we
  /// signal the MAIN engine to capture the full frame and open a proper
  /// full-screen crop editor. A normal Flutter route has no OEM size cap.
  Future<void> _enterSelector() async {
    if (_isCapturing) return;
    HapticFeedback.heavyImpact();
    setState(() {
      _isCapturing = true;
      _rippleKey++;
    });
    await CaptureTriggerBridge.sendRegionCapture();
    await Future<void>.delayed(const Duration(milliseconds: 600));
    if (mounted) setState(() => _isCapturing = false);
  }

  @override
  Widget build(BuildContext context) => _buildBubble();

  Widget _buildBubble() {
    final accent = _success ? const Color(0xFF10B981) : const Color(0xFF7C3AED);
    return Material(
      color: Colors.transparent,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: _handleTap,
        onLongPress: _enterSelector,
        child: SizedBox.expand(
          child: Stack(
            alignment: Alignment.center,
            children: [
                AnimatedBuilder(
                  animation: _glow,
                  builder: (_, __) => Stack(
                    alignment: Alignment.center,
                    clipBehavior: Clip.none,
                    children: [
                      // Expanding ripple on every capture tap.
                      if (_rippleKey > 0)
                        _RippleRing(key: ValueKey(_rippleKey)),
                      AnimatedContainer(
                        duration: const Duration(milliseconds: 180),
                        width: _isCapturing ? 54 : 58,
                        height: _isCapturing ? 54 : 58,
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: _success
                                ? [const Color(0xFF059669), const Color(0xFF10B981)]
                                : const [
                                    Color(0xFF6D28D9),
                                    Color(0xFF8B5CF6),
                                    Color(0xFFA78BFA)
                                  ],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 2.5),
                          boxShadow: [
                            BoxShadow(
                              color: accent.withValues(alpha: 0.6),
                              blurRadius: 14 + 8 * _glow.value,
                              spreadRadius: 2,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: Stack(
                          alignment: Alignment.center,
                          children: [
                            // Camera-flash white pulse right after tap.
                            if (_flash)
                              Positioned.fill(
                                child: Container(
                                  decoration: const BoxDecoration(
                                    shape: BoxShape.circle,
                                    color: Color(0xB3FFFFFF),
                                  ),
                                ),
                              ),
                            Icon(
                              _isCapturing
                                  ? Icons.hourglass_top_rounded
                                  : _success
                                      ? Icons.check_rounded
                                      : Icons.camera_alt_rounded,
                              color: Colors.white,
                              size: 26,
                            ),
                            Positioned(
                              top: 4,
                              right: 4,
                              child: Container(
                                width: 10,
                                height: 10,
                                decoration: BoxDecoration(
                                  color: const Color(0xFF10B981),
                                  shape: BoxShape.circle,
                                  border: Border.all(
                                      color: Colors.white, width: 1.5),
                                ),
                              ),
                            ),
                            if (_todayCount > 0)
                              Positioned(
                                top: -2,
                                left: -2,
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 5, vertical: 1),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFF0B1120),
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(
                                        color: const Color(0xFFA78BFA),
                                        width: 1),
                                  ),
                                  child: Text(
                                    '$_todayCount',
                                    style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 9,
                                        fontWeight: FontWeight.w700),
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              // Mini thumbnail peek: corner card that stays inside the
              // overlay window so the 96dp bubble never overflows.
              if (_peekPath != null)
                Positioned(
                  right: 2,
                  bottom: 2,
                  child: Container(
                    width: 34,
                    height: 44,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: Colors.white, width: 2),
                      boxShadow: [
                        BoxShadow(
                          color: accent.withValues(alpha: 0.5),
                          blurRadius: 10,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(6),
                      child: Image.file(
                        File(_peekPath!),
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) =>
                            const SizedBox.shrink(),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One-shot expanding ring fired on every capture tap.
class _RippleRing extends StatefulWidget {
  const _RippleRing({super.key});
  @override
  State<_RippleRing> createState() => _RippleRingState();
}

class _RippleRingState extends State<_RippleRing>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 500),
  );

  @override
  void initState() {
    super.initState();
    _ctrl.forward();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _ctrl,
      builder: (_, __) {
        final t = _ctrl.value;
        return Transform.scale(
          scale: 1 + t * 1.1,
          child: Opacity(
            opacity: (1 - t) * 0.7,
            child: Container(
              width: 58,
              height: 58,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white, width: 2),
              ),
            ),
          ),
        );
      },
    );
  }
}


