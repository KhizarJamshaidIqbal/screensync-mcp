import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_overlay_window/flutter_overlay_window.dart';

import 'package:screensync_flutter_project/services/floating_overlay_service.dart';

void main() {
  // The flutter_test default view is 800x600 logical px, so with a 120dp
  // bubble the valid window range is x:[0,680], y:[0,480].

  testWidgets('displayLogicalSize resolves the test display', (tester) async {
    final size = FloatingOverlayService.displayLogicalSize();
    expect(size.width, greaterThan(0));
    expect(size.height, greaterThan(0));
  });

  testWidgets('clampToScreen keeps in-bounds positions untouched',
      (tester) async {
    const position = OverlayPosition(100, 200);
    final clamped = FloatingOverlayService.clampToScreen(position);
    expect(clamped.x, 100);
    expect(clamped.y, 200);
  });

  testWidgets('clampToScreen pulls flung bubbles back on-screen',
      (tester) async {
    final clamped =
        FloatingOverlayService.clampToScreen(const OverlayPosition(5000, -40));
    expect(clamped.x, lessThanOrEqualTo(800));
    expect(clamped.x, greaterThanOrEqualTo(0));
    expect(clamped.y, 0);
  });

  testWidgets('defaultPosition sits fully on-screen', (tester) async {
    final position = FloatingOverlayService.defaultPosition();
    expect(position.x, greaterThanOrEqualTo(0));
    expect(position.y, greaterThanOrEqualTo(0));
    expect(position.x + FloatingOverlayService.bubbleSize,
        lessThanOrEqualTo(800));
    expect(position.y + FloatingOverlayService.bubbleSize,
        lessThanOrEqualTo(600));
  });
}
