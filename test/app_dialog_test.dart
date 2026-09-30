import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:screensync_flutter_project/core/app_theme.dart';
import 'package:screensync_flutter_project/widgets/app_dialog.dart';

/// [AppDialog] itself, the one dialog every screen builds on: a scrolling body
/// with pinned buttons, keyboard lift, theme-driven surface, busy / disabled
/// actions and proper accessibility. The update and preset dialogs add their
/// own tests on top of this.
Future<void> _show(
  WidgetTester tester,
  Widget Function(BuildContext) build, {
  Size size = const Size(393, 852),
  ThemeData? theme,
  double keyboard = 0,
}) async {
  tester.view.physicalSize = size * 2;
  tester.view.devicePixelRatio = 2;
  tester.view.viewInsets = FakeViewPadding(bottom: keyboard * 2);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetViewInsets);

  await tester.pumpWidget(MaterialApp(
    theme: theme ?? AppTheme.light(),
    home: Builder(
      builder: (context) => Scaffold(
        body: Center(
          child: TextButton(
            onPressed: () => AppDialog.showCustom<void>(
              context,
              builder: build,
            ),
            child: const Text('open'),
          ),
        ),
      ),
    ),
  ));
  await tester.tap(find.text('open'));
  // Not pumpAndSettle: a busy action's spinner animates forever.
  for (var i = 0; i < 4; i++) {
    await tester.pump(const Duration(milliseconds: 250));
  }
}

Rect _r(WidgetTester t, Finder f) => t.getRect(f);

void main() {
  testWidgets('a long body scrolls and the buttons stay on screen',
      (tester) async {
    await _show(
      tester,
      (_) => AppDialog(
        title: 'Long one',
        message: List.filled(40, 'A very long sentence that keeps going.').join(' '),
        icon: Icons.info_outline_rounded,
        actions: [
          AppDialogAction(label: 'Cancel', onPressed: () {}),
          AppDialogAction(label: 'Go', primary: true, onPressed: () {}),
        ],
      ),
      size: const Size(360, 480),
    );
    expect(tester.takeException(), isNull);
    expect(_r(tester, find.text('Go')).bottom, lessThanOrEqualTo(480));
    expect(_r(tester, find.text('Cancel')).bottom, lessThanOrEqualTo(480));
    expect(find.byType(SingleChildScrollView), findsOneWidget);
  });

  testWidgets('the pinned slot stays visible while the body scrolls',
      (tester) async {
    await _show(
      tester,
      (_) => AppDialog(
        title: 'Pinned',
        message: List.filled(40, 'Filler text to force the body to scroll.').join(' '),
        pinned: const Text('PINNED STATUS'),
        actions: [AppDialogAction(label: 'Go', primary: true, onPressed: () {})],
      ),
      size: const Size(360, 400),
    );
    expect(tester.takeException(), isNull);
    final pinned = _r(tester, find.text('PINNED STATUS'));
    expect(pinned.bottom, lessThanOrEqualTo(400));
    expect(pinned.top, lessThan(_r(tester, find.text('Go')).top));
  });

  testWidgets('the dialog lifts above the keyboard', (tester) async {
    Widget dialog(BuildContext _) => AppDialog(
          title: 'Name it',
          content: const TextField(key: Key('name')),
          actions: [AppDialogAction(label: 'Save', primary: true, onPressed: () {})],
        );

    await _show(tester, dialog, size: const Size(393, 600));
    final without = _r(tester, find.text('Save')).bottom;

    await tester.pumpWidget(const SizedBox());
    await _show(tester, dialog, size: const Size(393, 600), keyboard: 300);
    final withKeyboard = _r(tester, find.text('Save')).bottom;

    expect(withKeyboard, lessThanOrEqualTo(600 - 300),
        reason: 'the buttons must sit above the keyboard');
    expect(withKeyboard, lessThan(without));
  });

  group('actions', () {
    testWidgets('a busy action shows a spinner and cannot be tapped twice',
        (tester) async {
      var taps = 0;
      await _show(
        tester,
        (_) => AppDialog(
          title: 'Busy',
          actions: [
            AppDialogAction(
              label: 'Working...',
              primary: true,
              busy: true,
              icon: Icons.download_rounded,
              onPressed: () => taps++,
            ),
          ],
        ),
      );
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.byIcon(Icons.download_rounded), findsNothing,
          reason: 'the spinner replaces the icon');
      await tester.tap(find.text('Working...'));
      expect(taps, 0);
    });

    testWidgets('a disabled action is inert; an enabled one fires',
        (tester) async {
      var ok = 0, cancel = 0;
      await _show(
        tester,
        (_) => AppDialog(
          title: 'Two',
          actions: [
            const AppDialogAction(label: 'Cancel'),
            AppDialogAction(label: 'OK', primary: true, onPressed: () => ok++),
          ],
        ),
      );
      await tester.tap(find.text('Cancel'));
      await tester.tap(find.text('OK'));
      expect(cancel, 0);
      expect(ok, 1);
    });

    testWidgets('buttons are at least 48dp tall', (tester) async {
      await _show(
        tester,
        (_) => AppDialog(
          title: 'Targets',
          actions: [
            AppDialogAction(label: 'No', onPressed: () {}),
            AppDialogAction(label: 'Yes', primary: true, onPressed: () {}),
          ],
        ),
      );
      for (final label in ['No', 'Yes']) {
        final button = find.ancestor(
            of: find.text(label), matching: find.byType(InkWell));
        expect(_r(tester, button).height, greaterThanOrEqualTo(48),
            reason: '$label is too small to hit comfortably');
      }
    });

    testWidgets('two wide buttons wrap instead of overflowing', (tester) async {
      await _show(
        tester,
        (_) => AppDialog(
          title: 'Narrow',
          actions: [
            AppDialogAction(label: 'A fairly long secondary label', onPressed: () {}),
            AppDialogAction(
                label: 'A fairly long primary label',
                primary: true,
                icon: Icons.download_rounded,
                onPressed: () {}),
          ],
        ),
        size: const Size(320, 568),
      );
      expect(tester.takeException(), isNull);
    });
  });

  group('accessibility', () {
    testWidgets('the dialog is a named route and its buttons expose tap',
        (tester) async {
      final handle = tester.ensureSemantics();
      var taps = 0;
      await _show(
        tester,
        (_) => AppDialog(
          title: 'Delete frame',
          actions: [
            AppDialogAction(label: 'Delete', primary: true, onPressed: () => taps++),
            const AppDialogAction(label: 'Keep'),
          ],
        ),
      );

      final route = tester
          .getSemantics(find.bySemanticsLabel('Delete frame').first)
          .getSemanticsData();
      expect(route.flagsCollection.namesRoute, isTrue);
      expect(route.flagsCollection.scopesRoute, isTrue);

      final delete = tester.getSemantics(find.bySemanticsLabel('Delete'));
      expect(delete.getSemanticsData().flagsCollection.isButton, isTrue);
      expect(delete.getSemanticsData().hasAction(SemanticsAction.tap), isTrue,
          reason: 'Switch Access / Voice Access need the tap action');
      tester.semantics.tap(find.semantics.byLabel('Delete'));
      expect(taps, 1);

      final keep = tester.getSemantics(find.bySemanticsLabel('Keep'));
      expect(keep.getSemanticsData().hasAction(SemanticsAction.tap), isFalse,
          reason: 'a disabled action must not advertise a tap');
      handle.dispose();
    });
  });

  group('theme', () {
    Color surfaceOf(WidgetTester tester) {
      final box = tester.widget<Container>(find
          .descendant(
              of: find.byType(AppDialog), matching: find.byType(Container))
          .first);
      return (box.decoration! as BoxDecoration).color!;
    }

    testWidgets('light and dark use the theme surface', (tester) async {
      Widget d(BuildContext _) => const AppDialog(title: 'T');
      await _show(tester, d, theme: AppTheme.light());
      expect(surfaceOf(tester).withValues(alpha: 1), AppTheme.lightSurface);
      await tester.pumpWidget(const SizedBox());
      await _show(tester, d, theme: AppTheme.dark());
      expect(surfaceOf(tester).withValues(alpha: 1), AppTheme.darkSurface);
    });

    testWidgets('AMOLED mode reaches the dialog, like every stock widget',
        (tester) async {
      await _show(tester, (_) => const AppDialog(title: 'T'),
          theme: AppTheme.dark(amoled: true));
      expect(surfaceOf(tester).withValues(alpha: 1), const Color(0xFF0A0A0A));
    });
  });
}
