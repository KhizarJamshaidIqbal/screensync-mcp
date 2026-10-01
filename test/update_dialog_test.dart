import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:screensync_flutter_project/core/app_theme.dart';
import 'package:screensync_flutter_project/models/update_progress.dart';
import 'package:screensync_flutter_project/services/app_update_service.dart';
import 'package:screensync_flutter_project/services/settings_service.dart';
import 'package:screensync_flutter_project/widgets/app_dialog.dart';
import 'package:screensync_flutter_project/widgets/app_progress_bar.dart';
import 'package:screensync_flutter_project/widgets/update/update_dialog.dart';

/// The branded update dialog on its own: every state it can be in, at phone
/// sizes from a small portrait screen to a short landscape one, in light and
/// dark. It is shown through [AppDialog.showCustom] like the gate does.
class _Svc extends AppUpdateService {
  _Svc() : super.forTesting();

  final dismissed = <int>[];

  /// Completes the install; the test drives progress through [progress].
  Completer<String> installDone = Completer<String>();
  void Function(UpdateProgress)? progress;
  int installs = 0;

  @override
  Future<void> dismiss(int versionCode, {DateTime? now}) async =>
      dismissed.add(versionCode);

  @override
  Future<String> install(
    AppUpdateInfo info, {
    String? token,
    void Function(UpdateProgress progress)? onProgress,
  }) {
    installs++;
    progress = onProgress;
    return installDone.future;
  }
}

const _hub = AppUpdateInfo(
  versionName: '2.5.6',
  versionCode: 34,
  sha256: '73b950cf2cda39650000000000000000',
  sizeBytes: 94624099,
  url: 'http://hub.test:3000/apk',
  updateAvailable: true,
  bearerAuth: true,
  installedLabel: '2.5.5 (33)',
);

const _play = AppUpdateInfo(
  versionName: '34',
  versionCode: 34,
  sha256: '',
  sizeBytes: 0,
  url: '',
  updateAvailable: true,
  playManaged: true,
);

/// While an install runs the busy spinner animates forever, so the tree never
/// "settles": advance a fixed time instead of `pumpAndSettle`.
Future<void> _tick(WidgetTester tester) =>
    tester.pump(const Duration(milliseconds: 600));

/// Opens the dialog the way the gate does and returns what it closed with.
Future<void> _open(
  WidgetTester tester,
  _Svc svc,
  AppUpdateInfo info, {
  Size size = const Size(393, 852),
  ThemeData? theme,
  double textScale = 1.0,
  void Function(UpdateDialogResult?)? onResult,
}) async {
  tester.view.physicalSize = size * 2;
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  await tester.pumpWidget(MaterialApp(
    theme: theme ?? AppTheme.light(),
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(
        textScaler: TextScaler.linear(textScale),
      ),
      child: child!,
    ),
    home: Builder(
      builder: (context) => Scaffold(
        body: Center(
          child: TextButton(
            onPressed: () async {
              final r = await AppDialog.showCustom<UpdateDialogResult>(
                context,
                barrierDismissible: false,
                builder: (_) => UpdateDialog(
                  info: info,
                  service: svc,
                  token: () => 'screensync-local-dev',
                  refresh: () async => info,
                ),
              );
              onResult?.call(r);
            },
            child: const Text('open'),
          ),
        ),
      ),
    ),
  ));
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await SettingsService.instance.init();
  });

  group('content', () {
    testWidgets('hub build: versions, size, checksum and both actions',
        (tester) async {
      await _open(tester, _Svc(), _hub);

      expect(find.text('UPDATE READY'), findsOneWidget);
      expect(find.text('ScreenSync 2.5.6'), findsOneWidget);
      expect(find.text('THIS BUILD'), findsOneWidget);
      expect(find.text('2.5.5 (33)'), findsOneWidget);
      expect(find.text('NEW'), findsOneWidget);
      expect(find.text('2.5.6 (34)'), findsOneWidget);
      expect(find.text('90.2 MB'), findsOneWidget);
      expect(find.textContaining('SHA-256 73b950cf2cda3965'), findsOneWidget);
      expect(find.textContaining('ask again in 24 hours'), findsOneWidget);
      expect(find.text('Later'), findsOneWidget);
      expect(find.text('Update now'), findsOneWidget);
      expect(find.byType(AppProgressBar), findsNothing);
    });

    testWidgets('an unknown installed build shows only the new one',
        (tester) async {
      await _open(
        tester,
        _Svc(),
        const AppUpdateInfo(
          versionName: '2.5.6',
          versionCode: 34,
          sha256: '',
          sizeBytes: 0,
          url: 'http://hub.test:3000/apk',
          updateAvailable: true,
        ),
      );
      expect(find.text('THIS BUILD'), findsNothing);
      expect(find.text('NEW'), findsOneWidget);
    });

    testWidgets('Play build: required, no Later, no version row',
        (tester) async {
      await _open(tester, _Svc(), _play);

      expect(find.text('UPDATE REQUIRED'), findsOneWidget);
      expect(find.text('Update ScreenSync'), findsOneWidget);
      expect(find.text('Google Play'), findsOneWidget);
      expect(find.text('THIS BUILD'), findsNothing);
      expect(find.text('Later'), findsNothing);
      expect(find.text('Update now'), findsOneWidget);
    });
  });

  group('working', () {
    testWidgets('shows a live progress bar and locks both buttons',
        (tester) async {
      final svc = _Svc();
      await _open(tester, svc, _hub);

      await tester.tap(find.text('Update now'));
      await tester.pump();
      svc.progress!(const UpdateProgress.downloading(47312050, 94624099));
      await _tick(tester);

      expect(svc.installs, 1);
      expect(find.byType(AppProgressBar), findsOneWidget);
      expect(
        tester.widget<AppProgressBar>(find.byType(AppProgressBar)).value,
        closeTo(0.5, 0.001),
      );
      expect(find.text('Downloading - 50% - 45.1 of 90.2 MB'), findsOneWidget);
      expect(find.text('Downloading...'), findsOneWidget);
      expect(find.text('Update now'), findsNothing);

      // Both buttons are inert while the install runs.
      await tester.tap(find.text('Later'));
      await tester.tap(find.text('Downloading...'));
      await tester.pump();
      expect(svc.dismissed, isEmpty);
      expect(svc.installs, 1, reason: 'a second tap must not start a second install');

      svc.progress!(const UpdateProgress.verifying());
      await _tick(tester);
      expect(find.text('Verifying the download...'), findsOneWidget);

      svc.progress!(const UpdateProgress.opening());
      await _tick(tester);
      expect(find.text('Opening the installer...'), findsOneWidget);

      svc.installDone.complete('Installer opened - confirm the update on screen.');
      await tester.pumpAndSettle();
      expect(find.byType(AppProgressBar), findsNothing);
      expect(find.text('Installer opened - confirm the update on screen.'),
          findsOneWidget);
      expect(find.byIcon(Icons.check_circle_rounded), findsOneWidget);
      expect(find.text('Update now'), findsOneWidget,
          reason: 'the user can try again after the outcome');
    });

    testWidgets('a failure is a red banner, not a silent reset', (tester) async {
      final svc = _Svc();
      await _open(tester, svc, _hub);
      await tester.tap(find.text('Update now'));
      await tester.pump();
      svc.installDone.complete('Download failed: could not reach the hub.');
      await tester.pumpAndSettle();

      expect(find.text('Download failed: could not reach the hub.'),
          findsOneWidget);
      expect(find.byIcon(Icons.error_outline_rounded), findsOneWidget);
    });

    testWidgets('Later closes the dialog and is remembered', (tester) async {
      final svc = _Svc();
      UpdateDialogResult? result;
      await _open(tester, svc, _hub, onResult: (r) => result = r);
      await tester.tap(find.text('Later'));
      await tester.pumpAndSettle();

      expect(result, UpdateDialogResult.later);
      expect(svc.dismissed, [34]);
      expect(find.text('ScreenSync 2.5.6'), findsNothing);
    });
  });

  test('classify sorts the service sentences into a look', () {
    UpdateStatusKind k(String s) => UpdateDialog.classify(s);
    String real(String status) => AppUpdateService.installResultMessage(status);

    // Driven by the REAL sentences, so rewording the service cannot quietly
    // turn a success into a red banner while every test stays green.
    expect(k(real('started')), UpdateStatusKind.success);
    expect(k(real('needs_permission')), UpdateStatusKind.attention);
    expect(k(real('error: disk full')), UpdateStatusKind.problem);
    expect(k(real('something else')), UpdateStatusKind.problem);

    // Lines the gate and the Play path produce themselves.
    expect(k('Installed - Google Play restarted the app.'),
        UpdateStatusKind.success);
    expect(k('No update is available any more.'), UpdateStatusKind.info);
    expect(k('Update cancelled. It is still required.'), UpdateStatusKind.info);
    expect(k('Download failed (HTTP 500).'), UpdateStatusKind.problem);
    expect(k('The downloaded update failed its SHA-256 check and was discarded.'),
        UpdateStatusKind.problem);
  });

  group('layout never overflows', () {
    const sizes = <String, Size>{
      'small portrait 320x568': Size(320, 568),
      'portrait 360x640': Size(360, 640),
      'portrait 393x852': Size(393, 852),
      'short landscape 700x320': Size(700, 320),
    };

    void inside(WidgetTester tester, Finder f, Size view) {
      final r = tester.getRect(f);
      expect(r.top, greaterThanOrEqualTo(0), reason: '$f starts above the screen');
      expect(r.bottom, lessThanOrEqualTo(view.height),
          reason: '$f ends below the screen');
    }

    for (final themeName in <String>['light', 'dark']) {
      for (final scale in <double>[1.0, 1.3]) {
        for (final e in sizes.entries) {
          testWidgets('${e.key}, $themeName, text x$scale', (tester) async {
            final svc = _Svc();
            await _open(
              tester,
              svc,
              _hub,
              size: e.value,
              textScale: scale,
              theme: themeName == 'dark' ? AppTheme.dark() : AppTheme.light(),
            );
            expect(tester.takeException(), isNull);
            expect(find.text('Update now'), findsOneWidget);
            inside(tester, find.text('Update now'), e.value);

            await tester.tap(find.text('Update now'));
            await tester.pump();
            svc.progress!(const UpdateProgress.downloading(1000, 4000));
            await _tick(tester);
            expect(tester.takeException(), isNull);

            // What the install is doing must stay in view next to the
            // buttons, even where the body above it has to scroll.
            inside(tester, find.byType(AppProgressBar), e.value);
            inside(tester, find.text('Downloading...'), e.value);

            // The long "allow install unknown apps" outcome is the tallest
            // banner: it too must be visible, not scrolled away.
            svc.installDone.complete(
                AppUpdateService.installResultMessage('needs_permission'));
            await tester.pumpAndSettle();
            expect(tester.takeException(), isNull);
            // A banner taller than its share scrolls inside it, so its END may
            // be below the fold; its START and the buttons must be in view.
            final banner = tester.getRect(find.textContaining('Install unknown apps'));
            expect(banner.top, inInclusiveRange(0, e.value.height - 1));
            inside(tester, find.text('Update now'), e.value);
          });
        }
      }
    }

    testWidgets('Play build at the smallest size', (tester) async {
      await _open(tester, _Svc(), _play, size: const Size(320, 568), textScale: 1.3);
      expect(tester.takeException(), isNull);
      expect(find.text('Update now'), findsOneWidget);
      inside(tester, find.text('Update now'), const Size(320, 568));
    });

    testWidgets('a long build label scales down instead of ellipsizing',
        (tester) async {
      await _open(
        tester,
        _Svc(),
        const AppUpdateInfo(
          versionName: '2.5.10',
          versionCode: 133,
          sha256: '',
          sizeBytes: 0,
          url: 'http://hub.test:3000/apk',
          updateAvailable: true,
          installedLabel: '2.5.9 (132)',
        ),
        size: const Size(320, 568),
        textScale: 1.3,
      );
      expect(tester.takeException(), isNull);
      expect(find.text('2.5.10 (133)'), findsOneWidget);
    });
  });
}
