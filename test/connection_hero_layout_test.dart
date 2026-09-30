import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:screensync_flutter_project/core/app_theme.dart';
import 'package:screensync_flutter_project/services/connection_metrics_service.dart';
import 'package:screensync_flutter_project/widgets/connection_hero/hero_status_row.dart';
import 'package:screensync_flutter_project/widgets/connection_hero/live_sse_indicator.dart';

/// The hero's first row used to be Flexible(pill) + chip + Spacer + SSE + badge.
/// Flexible and Spacer split the leftover width equally, so on a 393 dp phone the
/// pill got about 30 dp and rendered as a dot with no label, and "Excellent" was
/// shown twice (chip and badge). These tests pump the row inside the same
/// padding chain the dashboard uses (list gutter 20, hero panel 18 + 1 border).
void main() {
  const widths = <double>[320, 360, 393];

  Future<void> pumpRow(
    WidgetTester tester,
    double width, {
    bool authFailed = false,
    LinkHealth health = LinkHealth.excellent,
    double textScale = 1,
  }) async {
    await tester.binding.setSurfaceSize(Size(width, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(
          size: Size(width, 800),
          textScaler: TextScaler.linear(textScale),
        ),
        child: Scaffold(
          body: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: GlassPanel(
              padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
              child: HeroStatusRow(
                online: true,
                checking: false,
                latencyMs: 42,
                liveConnected: true,
                health: health,
                authFailed: authFailed,
              ),
            ),
          ),
        ),
      ),
    ));
    await tester.pump();
  }

  RenderParagraph paragraphOf(WidgetTester tester, Finder finder) =>
      tester.renderObject<RenderParagraph>(finder);

  for (final width in widths) {
    testWidgets('pill label is fully visible at ${width.toInt()} dp',
        (tester) async {
      await pumpRow(tester, width);

      final label = find.textContaining('CONNECTED');
      expect(label, findsOneWidget);
      expect(tester.getSize(label).width, greaterThan(0));
      expect(paragraphOf(tester, label).didExceedMaxLines, isFalse,
          reason: 'the label must not be ellipsized away');
      expect(tester.takeException(), isNull,
          reason: 'no RenderFlex overflow');

      await tester.pumpWidget(const SizedBox.shrink());
    });

    testWidgets('"Excellent" appears once at ${width.toInt()} dp',
        (tester) async {
      await pumpRow(tester, width);

      expect(find.text('Excellent'), findsOneWidget);
      expect(find.byType(LiveSseIndicator), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(const SizedBox.shrink());
    });
  }

  testWidgets('a larger system font still lays out without overflow at 320 dp',
      (tester) async {
    await pumpRow(tester, 320, textScale: 1.6);

    expect(tester.takeException(), isNull);
    expect(tester.getSize(find.textContaining('CONNECTED')).width, greaterThan(0));

    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('a rejected token reads as an auth problem, never "Excellent"',
      (tester) async {
    await pumpRow(tester, 360,
        authFailed: true, health: LinkHealth.authProblem);

    expect(find.textContaining('AUTH PROBLEM'), findsOneWidget);
    expect(find.textContaining('CONNECTED'), findsNothing);
    expect(find.text('Auth problem'), findsOneWidget);
    expect(find.text('Excellent'), findsNothing);
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('control: the old Flexible + Spacer row fails this same check',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(393, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: GlassPanel(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
            child: Row(
              children: [
                const Flexible(
                  child: HeroStatusPill(
                      online: true, checking: false, latencyMs: 42),
                ),
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: const Text('Excellent'),
                ),
                const Spacer(),
                const LiveSseIndicator(connected: true),
                const SizedBox(width: 6),
                const HeroHealthBadge(health: LinkHealth.excellent),
              ],
            ),
          ),
        ),
      ),
    ));
    await tester.pump();

    final overflowed = tester.takeException() != null;
    final label = find.textContaining('CONNECTED');
    final truncated = label.evaluate().isEmpty ||
        paragraphOf(tester, label).didExceedMaxLines;
    expect(overflowed || truncated, isTrue,
        reason: 'the harness must be able to see the original defect');

    await tester.pumpWidget(const SizedBox.shrink());
  });
}
