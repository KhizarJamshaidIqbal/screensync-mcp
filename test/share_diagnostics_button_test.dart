import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:screensync_flutter_project/blocs/screen_capture_bloc.dart';
import 'package:screensync_flutter_project/core/app_theme.dart';
import 'package:screensync_flutter_project/models/telemetry_event.dart';
import 'package:screensync_flutter_project/screens/tabs/telemetry_tab.dart';
import 'package:screensync_flutter_project/screens/telemetry/share_diagnostics_button.dart';

/// Only `state` and `stream` are read by the Telemetry tab.
class _FakeBloc extends Fake implements ScreenCaptureBloc {
  _FakeBloc(this._state);
  final ScreenCaptureState _state;

  @override
  ScreenCaptureState get state => _state;
  @override
  Stream<ScreenCaptureState> get stream => const Stream.empty();
  @override
  Future<void> close() async {}
}

final _state = ScreenCaptureState(
  hubUrl: 'http://192.168.1.10:3000',
  telemetry: [
    for (var i = 0; i < 6; i++)
      TelemetryEvent(
        kind: i.isEven ? 'upload' : 'discovery',
        label: 'LAN push frame_$i.png (512 KB) over a fairly long label',
        durationMs: 40 + i,
        ok: i != 3,
        timestamp: DateTime(2026, 10, 1, 9, 30, i),
      ),
  ],
);

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  required Size size,
  required ThemeData theme,
  double textScale = 1.0,
}) async {
  tester.view.physicalSize = size * 2;
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(MaterialApp(
    theme: theme,
    builder: (context, app) => MediaQuery(
      data: MediaQuery.of(context)
          .copyWith(textScaler: TextScaler.linear(textScale)),
      child: app!,
    ),
    home: Scaffold(body: child),
  ));
  await _frames(tester);
}

/// Not pumpAndSettle: decorative animations may never settle.
Future<void> _frames(WidgetTester tester) async {
  for (var i = 0; i < 4; i++) {
    await tester.pump(const Duration(milliseconds: 250));
  }
}

/// The tab is a scrolling list: at 320dp and text scale 1.3 the header can
/// push the buttons below the fold, which is fine as long as they scroll into
/// view whole. Call [_reveal] first for anything inside the list.
Future<void> _reveal(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pump();
}

void _onScreen(WidgetTester tester, Finder finder, Size size) {
  final rect = tester.getRect(finder);
  expect(rect.top, greaterThanOrEqualTo(0));
  expect(rect.left, greaterThanOrEqualTo(0));
  expect(rect.right, lessThanOrEqualTo(size.width));
  expect(rect.bottom, lessThanOrEqualTo(size.height));
}

void main() {
  final themes = {'light': AppTheme.light(), 'dark': AppTheme.dark()};
  const sizes = [Size(320, 568), Size(360, 640), Size(393, 852)];

  group('Telemetry tab share action', () {
    for (final theme in themes.entries) {
      for (final size in sizes) {
        for (final scale in [1.0, 1.3]) {
          testWidgets(
              '${theme.key} ${size.width.toInt()}dp x$scale: renders with no '
              'overflow', (tester) async {
            await _pump(
              tester,
              BlocProvider<ScreenCaptureBloc>.value(
                value: _FakeBloc(_state),
                child: const TelemetryTab(),
              ),
              size: size,
              theme: theme.value,
              textScale: scale,
            );
            expect(tester.takeException(), isNull);
            // The whole button, not just its label, must fit the width.
            final share = find.ancestor(
                of: find.text('Share diagnostics'),
                matching: find.bySubtype<FilledButton>());
            await _reveal(tester, share);
            _onScreen(tester, share, size);
            await _reveal(tester, find.text('Clear log'));
            _onScreen(tester, find.text('Clear log'), size);
            expect(tester.takeException(), isNull);
          });
        }
      }

      testWidgets('${theme.key} 320dp: the confirm dialog fits', (tester) async {
        const size = Size(320, 568);
        await _pump(
          tester,
          BlocProvider<ScreenCaptureBloc>.value(
            value: _FakeBloc(_state),
            child: const TelemetryTab(),
          ),
          size: size,
          theme: theme.value,
          textScale: 1.3,
        );
        await _reveal(tester, find.text('Share diagnostics'));
        await tester.tap(find.text('Share diagnostics'));
        await _frames(tester);

        expect(tester.takeException(), isNull);
        expect(find.text('Share diagnostics?'), findsOneWidget);
        expect(find.textContaining('pairing token is never included'),
            findsOneWidget);
        _onScreen(tester, find.text('Share'), size);
        _onScreen(tester, find.text('Cancel'), size);

        await tester.tap(find.text('Cancel'));
        await _frames(tester);
        expect(find.text('Share diagnostics?'), findsNothing);
      });
    }
  });

  group('ShareDiagnosticsButton flow', () {
    Future<void> open(WidgetTester tester, Future<bool> Function() onShare,
        {ThemeData? theme}) async {
      await _pump(
        tester,
        Padding(
          padding: const EdgeInsets.all(16),
          child: ShareDiagnosticsButton(onShare: onShare),
        ),
        size: const Size(320, 568),
        theme: theme ?? AppTheme.light(),
      );
      await tester.tap(find.text('Share diagnostics'));
      await _frames(tester);
    }

    testWidgets('Share runs the export once and shows no error',
        (tester) async {
      var calls = 0;
      await open(tester, () async {
        calls++;
        return true;
      });
      await tester.tap(find.text('Share'));
      await _frames(tester);
      expect(calls, 1);
      expect(find.text('Could not share'), findsNothing);
      expect(find.text('Share diagnostics?'), findsNothing);
    });

    testWidgets('Cancel exports nothing', (tester) async {
      var calls = 0;
      await open(tester, () async {
        calls++;
        return true;
      });
      await tester.tap(find.text('Cancel'));
      await _frames(tester);
      expect(calls, 0);
    });

    for (final theme in themes.entries) {
      testWidgets('${theme.key}: a failed export says so in an AppDialog',
          (tester) async {
        await open(tester, () async => false, theme: theme.value);
        await tester.tap(find.text('Share'));
        await _frames(tester);
        expect(tester.takeException(), isNull);
        expect(find.text('Could not share'), findsOneWidget);
        _onScreen(tester, find.text('OK'), const Size(320, 568));
        await tester.tap(find.text('OK'));
        await _frames(tester);
        expect(find.text('Could not share'), findsNothing);
      });
    }
  });
}
