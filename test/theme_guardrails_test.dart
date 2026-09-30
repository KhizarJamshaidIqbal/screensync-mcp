import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:screensync_flutter_project/core/app_theme.dart';

/// The app's UI template is enforced, not just written down (docs/UI_TEMPLATE.md):
///   * a dialog is an [AppDialog], never a stock AlertDialog / SimpleDialog;
///   * the global theme gives every stock Material widget the brand, so a widget
///     nobody styled still matches the app in light and dark.
/// A new widget that ignores the template fails here, in CI-less review or on a
/// local `flutter test`, instead of shipping off-brand.
void main() {
  group('stock dialogs', () {
    /// Non-comment source lines of every Dart file under lib/.
    Iterable<MapEntry<String, List<String>>> sources() sync* {
      final files = Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart'));
      for (final f in files) {
        final lines = f
            .readAsLinesSync()
            .where((l) => !l.trimLeft().startsWith('//'))
            .toList();
        yield MapEntry(f.path.replaceAll('\\', '/'), lines);
      }
    }

    test('no AlertDialog, SimpleDialog or CupertinoAlertDialog: use AppDialog',
        () {
      final pattern = RegExp(
          r'\b(AlertDialog|SimpleDialog|CupertinoAlertDialog)(\.adaptive)?\(');
      final offenders = <String>[
        for (final s in sources())
          if (s.value.any(pattern.hasMatch)) s.key,
      ];
      expect(offenders, isEmpty,
          reason: 'Build dialogs with AppDialog / AppDialog.showCustom '
              '(lib/widgets/app_dialog.dart). Stock dialogs bypass the brand '
              'surface, type, halo and buttons. Found in: $offenders');
    });

    test('showDialog only for the one bespoke brand dialog', () {
      const allowed = {'lib/widgets/connect_prompt_dialog.dart'};
      final pattern = RegExp(
          r'\b(showDialog|showAdaptiveDialog|showCupertinoDialog)\s*[<(]');
      final offenders = <String>[
        for (final s in sources())
          if (!allowed.contains(s.key) && s.value.any(pattern.hasMatch)) s.key,
      ];
      expect(offenders, isEmpty,
          reason: 'Use AppDialog.show / AppDialog.showCustom so the scrim, '
              'entrance animation and surface are shared. Found in: $offenders');
    });
  });

  group('global theme', () {
    final themes = <String, ThemeData>{
      'light': AppTheme.light(),
      'dark': AppTheme.dark(),
      'light, custom accent': AppTheme.light(accent: const Color(0xFF10B981)),
    };

    for (final e in themes.entries) {
      test('${e.key}: dialogs, text buttons, progress and sheets are branded',
          () {
        final t = e.value;
        final dark = t.brightness == Brightness.dark;
        final border = dark ? AppTheme.darkBorder : AppTheme.lightBorder;

        final dialogShape = t.dialogTheme.shape as RoundedRectangleBorder;
        expect(dialogShape.borderRadius,
            BorderRadius.circular(AppTheme.radiusL));
        expect(dialogShape.side.color, border);
        expect(t.dialogTheme.surfaceTintColor, Colors.transparent);
        expect(t.dialogTheme.titleTextStyle?.fontFamily, 'serif');

        final buttonShape = t.textButtonTheme.style?.shape?.resolve({});
        expect(buttonShape, isA<StadiumBorder>());

        expect(t.progressIndicatorTheme.linearTrackColor, border);
        // No ring behind a circular indicator: it would turn a small spinner
        // (the white one in a gradient button) into a static circle.
        expect(t.progressIndicatorTheme.circularTrackColor, isNull);
        expect(t.progressIndicatorTheme.color, t.colorScheme.primary);

        final sheetShape = t.bottomSheetTheme.shape as RoundedRectangleBorder;
        expect(sheetShape.borderRadius,
            const BorderRadius.vertical(top: Radius.circular(AppTheme.radiusL)));
      });
    }
  });

  testWidgets('a stock Material dialog still inherits the brand',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light(),
      home: Builder(
        builder: (context) => TextButton(
          onPressed: () => showDialog<void>(
            context: context,
            builder: (_) => const AlertDialog(title: Text('stock')),
          ),
          child: const Text('open'),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    final material = tester.widget<Material>(find
        .descendant(of: find.byType(AlertDialog), matching: find.byType(Material))
        .first);
    final shape = material.shape as RoundedRectangleBorder;
    expect(shape.borderRadius, BorderRadius.circular(AppTheme.radiusL));
    expect(material.color, AppTheme.lightSurface);
  });
}
