import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_overlay_window/flutter_overlay_window.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Controls the system overlay window that hosts the capture bubble.
///
/// Drag design notes (bug fix):
/// Dragging uses the plugin's native `enableDrag: true`, which moves the
/// window from raw screen-coordinate deltas (getRawX/getRawY). The original
/// "bubble won't move" bug was NOT enableDrag — it was `positionGravity: auto`,
/// whose per-gesture edge-snap Timer (OverlayService.java) is never cancelled
/// and yanks the bubble back to an edge. We keep `PositionGravity.none` so
/// that timer never runs. CRITICAL GOTCHA: the plugin's resizeOverlay handler
/// ALSO writes WindowSetup.enableDrag, so every resize call must pass
/// enableDrag=true or it silently disables native drag mid-boot.
class FloatingOverlayService {
  /// Window is deliberately larger than the 58dp visual bubble: the
  /// transparent ring absorbs vsync lag so the pointer stays inside the
  /// window during native drags (a window that lags behind the finger
  /// loses the gesture to the app underneath).
  static const bubbleSize = 96;

  static const _kBubbleX = 'bubble_pos_x';
  static const _kBubbleY = 'bubble_pos_y';
  static const _watchdogInterval = Duration(milliseconds: 1500);

  static Timer? _watchdog;
  static bool _watchdogPaused = false;
  static OverlayPosition? _parkedPosition;

  /// Must be called from the OVERLAY engine (the widget's initState): the
  /// plugin registers its resizeOverlay handler only there, so calling it
  /// from the main engine throws MissingPluginException. Fixes the plugin's
  /// raw-pixels-on-first-show sizing so the window is bubbleSize dp square.
  /// Retries because the overlay isolate can boot before the native service
  /// registers its channel handler.
  static Future<void> normalizeBubbleWindow() async {
    for (var attempt = 0; attempt < 6; attempt++) {
      try {
        // enableDrag MUST stay true: resizeOverlay writes WindowSetup.enableDrag.
        final ok = await FlutterOverlayWindow.resizeOverlay(
            bubbleSize, bubbleSize, true);
        if (ok == true) return;
      } catch (_) {/* handler not registered yet */}
      await Future<void>.delayed(const Duration(milliseconds: 400));
    }
  }

  /// Logical size of the physical display. Works in both engines and is
  /// independent of the overlay window's own size.
  static Size displayLogicalSize() {
    final view = WidgetsBinding.instance.platformDispatcher.views.first;
    return view.physicalSize / view.devicePixelRatio;
  }

  static Future<bool> showOverlayBubble() async {
    var isGranted = await FlutterOverlayWindow.isPermissionGranted();
    if (!isGranted) {
      isGranted = await FlutterOverlayWindow.requestPermission() == true;
    }
    if (!isGranted) return false;

    if (await FlutterOverlayWindow.isActive()) {
      _startWatchdog();
      return true;
    }

    final start = await loadBubblePosition() ?? defaultPosition();
    await FlutterOverlayWindow.showOverlay(
      height: bubbleSize,
      width: bubbleSize,
      alignment: OverlayAlignment.topLeft,
      enableDrag: true,
      positionGravity: PositionGravity.none,
      flag: OverlayFlag.defaultFlag,
      overlayTitle: 'ScreenSync',
      overlayContent: 'Tap to capture · long-press to crop · drag to move',
      visibility: NotificationVisibility.visibilityPublic,
      startPosition: start,
    );
    _normalizeAfterShow(start);
    _startWatchdog();
    return true;
  }

  static Future<void> closeOverlayBubble() async {
    _stopWatchdog(saveFirst: true);
    _parkedPosition = null;
    await FlutterOverlayWindow.closeOverlay();
  }

  /// The plugin lays the window out in raw *pixels* on first show but in
  /// *dp* on resize; size is normalized by the overlay widget via
  /// [normalizeBubbleWindow], and position is re-applied here shortly after
  /// the native service boots.
  static void _normalizeAfterShow(OverlayPosition position) {
    Future<void>.delayed(const Duration(milliseconds: 450), () async {
      try {
        await FlutterOverlayWindow.moveOverlay(clampToScreen(position));
      } catch (_) {/* service still booting; watchdog will correct position */}
    });
  }

  /// Expands the overlay window to cover the real display so the region
  /// selector has room. Parks the bubble position first and moves the window
  /// to the origin — otherwise the full-screen window would be anchored at
  /// the bubble and most of the selector UI would render off-screen.
  static Future<bool> expandToFullScreen() async {
    try {
      _watchdogPaused = true;
      _parkedPosition =
          clampToScreen(await FlutterOverlayWindow.getOverlayPosition());
      final display = displayLogicalSize();
      final resized = await FlutterOverlayWindow.resizeOverlay(
            display.width.round(),
            display.height.round(),
            false,
          ) ==
          true;
      if (!resized) {
        _watchdogPaused = false;
        return false;
      }
      await FlutterOverlayWindow.moveOverlay(const OverlayPosition(0, 0));
      return true;
    } catch (_) {
      _watchdogPaused = false;
      return false;
    }
  }

  /// Collapses back to bubble size and restores the parked bubble position.
  static Future<bool> collapseToBubble() async {
    try {
      final resized = await FlutterOverlayWindow.resizeOverlay(
            bubbleSize,
            bubbleSize,
            true,
          ) ==
          true;
      final restore = _parkedPosition ??
          await loadBubblePosition() ??
          defaultPosition();
      _parkedPosition = null;
      await FlutterOverlayWindow.moveOverlay(clampToScreen(restore));
      return resized;
    } catch (_) {
      return false;
    } finally {
      _watchdogPaused = false;
    }
  }

  static OverlayPosition defaultPosition() {
    final display = displayLogicalSize();
    return OverlayPosition(0, (display.height - bubbleSize) / 2);
  }

  /// Clamps a window position so the full bubble stays on the display.
  static OverlayPosition clampToScreen(OverlayPosition position) {
    final display = displayLogicalSize();
    final maxX = (display.width - bubbleSize).clamp(0.0, display.width);
    final maxY = (display.height - bubbleSize).clamp(0.0, display.height);
    return OverlayPosition(
      position.x.clamp(0.0, maxX),
      position.y.clamp(0.0, maxY),
    );
  }

  /// Polls the native window position, persists it, and pulls the bubble
  /// back on-screen if it was flung past an edge (no edge-snap gravity means
  /// nothing else would recover a lost bubble).
  static void _startWatchdog() {
    _watchdog?.cancel();
    _watchdog = Timer.periodic(_watchdogInterval, (_) => _watchdogTick());
  }

  static void _stopWatchdog({bool saveFirst = false}) {
    _watchdog?.cancel();
    _watchdog = null;
    if (saveFirst) _watchdogTick();
  }

  static Future<void> _watchdogTick() async {
    if (_watchdogPaused) return;
    try {
      final current = await FlutterOverlayWindow.getOverlayPosition();
      final clamped = clampToScreen(current);
      if ((clamped.x - current.x).abs() > 1 ||
          (clamped.y - current.y).abs() > 1) {
        await FlutterOverlayWindow.moveOverlay(clamped);
      }
      await saveBubblePosition(clamped);
    } catch (_) {/* overlay may be mid-teardown */}
  }

  static Future<OverlayPosition?> loadBubblePosition() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final x = prefs.getDouble(_kBubbleX);
      final y = prefs.getDouble(_kBubbleY);
      if (x == null || y == null) return null;
      return OverlayPosition(x, y);
    } catch (_) {
      return null;
    }
  }

  static Future<void> saveBubblePosition(OverlayPosition position) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await Future.wait([
        prefs.setDouble(_kBubbleX, position.x),
        prefs.setDouble(_kBubbleY, position.y),
      ]);
    } catch (_) {/* persistence is best-effort */}
  }
}
