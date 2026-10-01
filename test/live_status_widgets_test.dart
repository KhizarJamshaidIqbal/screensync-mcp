import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:screensync_flutter_project/screens/dashboard/bubble_status_card.dart';
import 'package:screensync_flutter_project/widgets/live_stream_strip.dart';

/// Two places used to overstate: the dashboard card said "Floating Bubble:
/// RUNNING" as soon as the bubble window was up (even with no capture session),
/// and the strip said LIVE whenever the SSE socket was open.
void main() {
  Future<void> pump(WidgetTester tester, Widget child) async {
    await tester.binding.setSurfaceSize(const Size(393, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: SingleChildScrollView(child: child)),
    ));
    // flutter_animate starts its clips on a zero-length timer.
    await tester.pump(const Duration(milliseconds: 50));
  }

  group('BubbleStatusCard', () {
    testWidgets('running with a live capture session is RUNNING',
        (tester) async {
      await pump(tester, const BubbleStatusCard(running: true));

      expect(find.text('RUNNING'), findsOneWidget);
      expect(find.text('NO CAPTURE'), findsNothing);
      expect(find.text('Grant screen capture'), findsNothing);
    });

    testWidgets('running WITHOUT a capture session says so and offers a grant',
        (tester) async {
      await pump(
          tester, const BubbleStatusCard(running: true, captureReady: false));

      expect(find.text('NO CAPTURE'), findsOneWidget);
      expect(find.text('RUNNING'), findsNothing);
      expect(find.textContaining('screen capture not active'), findsOneWidget);
      expect(find.text('Grant screen capture'), findsOneWidget);
    });

    testWidgets('the grant button waits while a prompt is already open',
        (tester) async {
      await pump(
          tester,
          const BubbleStatusCard(
              running: true, captureReady: false, consentPending: true));

      final button = tester.widget<OutlinedButton>(
          find.widgetWithText(OutlinedButton, 'Grant screen capture'));
      expect(button.onPressed, isNull);
    });

    testWidgets('a stopped bubble is STANDBY regardless of capture state',
        (tester) async {
      await pump(
          tester, const BubbleStatusCard(running: false, captureReady: false));

      expect(find.text('STANDBY'), findsOneWidget);
      expect(find.text('NO CAPTURE'), findsNothing);
      expect(find.text('Grant screen capture'), findsNothing);
    });

    testWidgets('fits a 320 dp phone with the extra state',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(320, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: BubbleStatusCard(running: true, captureReady: false),
          ),
        ),
      ));
      await tester.pump();

      expect(tester.takeException(), isNull);
    });
  });

  group('LiveStreamStrip', () {
    testWidgets('live shows LIVE', (tester) async {
      await pump(tester, const LiveStreamStrip(frames: [], live: true));

      expect(find.text('LIVE'), findsOneWidget);
      expect(find.text('WAITING'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
    });

    testWidgets('no recent frame is a neutral waiting state, not LIVE',
        (tester) async {
      final semantics = tester.ensureSemantics();
      await pump(tester, const LiveStreamStrip(frames: [], live: false));

      expect(find.text('LIVE'), findsNothing);
      expect(find.text('WAITING'), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp('Waiting for frames')), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      semantics.dispose();
    });
  });
}
