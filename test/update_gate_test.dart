import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:screensync_flutter_project/core/app_navigator.dart';
import 'package:screensync_flutter_project/models/update_progress.dart';
import 'package:screensync_flutter_project/services/app_update_service.dart';
import 'package:screensync_flutter_project/services/settings_service.dart';
import 'package:screensync_flutter_project/widgets/update_gate.dart';

/// The gate sits in MaterialApp.builder, ABOVE the Navigator, so a plain
/// `showDialog(context: context)` from it throws and the dialog can never
/// appear. These tests pump it exactly as main.dart wires it (builder +
/// navigatorKey) with a fake update service.
class _FakeUpdateService extends AppUpdateService {
  _FakeUpdateService({this.result, this.throwOnCheck = false})
      : super.forTesting();

  AppUpdateInfo? result;
  bool throwOnCheck;
  bool autoEnabled = true;
  int checks = 0;
  final dismissed = <int>[];
  final installs = <AppUpdateInfo>[];

  @override
  Future<bool> autoCheckEnabled() async => autoEnabled;

  @override
  Future<AppUpdateInfo?> check({
    required String hubUrl,
    required String token,
    bool manual = false,
  }) async {
    checks++;
    if (throwOnCheck) throw StateError('boom');
    return result;
  }

  @override
  Future<bool> isDismissed(int versionCode, {DateTime? now}) async =>
      dismissed.contains(versionCode);

  @override
  Future<void> dismiss(int versionCode, {DateTime? now}) async =>
      dismissed.add(versionCode);

  @override
  Future<String> install(
    AppUpdateInfo info, {
    String? token,
    void Function(UpdateProgress progress)? onProgress,
  }) async {
    installs.add(info);
    return 'Installer opened - confirm the update on screen.';
  }
}

const _hubUpdate = AppUpdateInfo(
  versionName: '2.5.5',
  versionCode: 33,
  sha256: 'abcdef0123456789abcdef0123456789',
  sizeBytes: 1024,
  url: 'http://hub.test:3000/apk',
  updateAvailable: true,
  bearerAuth: true,
);

const _playUpdate = AppUpdateInfo(
  versionName: '33',
  versionCode: 33,
  sha256: '',
  sizeBytes: 0,
  url: '',
  updateAvailable: true,
  playManaged: true,
);

Widget _app(_FakeUpdateService fake) => MaterialApp(
      navigatorKey: appNavigatorKey,
      builder: (context, child) => AppUpdateGate(
        service: fake,
        hubUrlResolver: (_) => 'http://hub.test:3000',
        child: child!,
      ),
      home: const Scaffold(body: Text('home screen')),
    );

Future<void> _resume(WidgetTester tester) async {
  final binding = tester.binding;
  for (final state in <AppLifecycleState>[
    AppLifecycleState.inactive,
    AppLifecycleState.hidden,
    AppLifecycleState.paused,
    AppLifecycleState.hidden,
    AppLifecycleState.inactive,
    AppLifecycleState.resumed,
  ]) {
    binding.handleAppLifecycleStateChanged(state);
  }
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await SettingsService.instance.init();
  });

  testWidgets('shows the update dialog through the app navigator',
      (tester) async {
    final fake = _FakeUpdateService(result: _hubUpdate);
    await tester.pumpWidget(_app(fake));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('home screen'), findsOneWidget);
    expect(find.text('ScreenSync 2.5.5'), findsOneWidget);
    expect(find.text('Update now'), findsOneWidget);
    expect(find.text('Later'), findsOneWidget);
    expect(fake.checks, 1);
  });

  testWidgets('Play-managed update is required: no Later, back is refused',
      (tester) async {
    final fake = _FakeUpdateService(result: _playUpdate);
    await tester.pumpWidget(_app(fake));
    await tester.pumpAndSettle();

    expect(find.text('UPDATE REQUIRED'), findsOneWidget);
    expect(find.text('Later'), findsNothing);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('UPDATE REQUIRED'), findsOneWidget,
        reason: 'the back button must not dismiss a required update');
  });

  testWidgets('Update now routes through the service and reports the result',
      (tester) async {
    final fake = _FakeUpdateService(result: _hubUpdate);
    await tester.pumpWidget(_app(fake));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Update now'));
    await tester.pumpAndSettle();

    expect(fake.installs, <AppUpdateInfo>[_hubUpdate]);
    expect(find.text('Installer opened - confirm the update on screen.'),
        findsOneWidget);
  });

  group('the hub republishes while the dialog is open', () {
    // Same versionCode, but the file was rebuilt: new size and SHA-256.
    const rebuilt = AppUpdateInfo(
      versionName: '2.5.5',
      versionCode: 33,
      sha256: '1111111111111111aaaaaaaaaaaaaaaa',
      sizeBytes: 2048,
      url: 'http://hub.test:3000/apk',
      updateAvailable: true,
      bearerAuth: true,
    );
    // A newer build altogether.
    const newer = AppUpdateInfo(
      versionName: '2.5.6',
      versionCode: 34,
      sha256: '2222222222222222bbbbbbbbbbbbbbbb',
      sizeBytes: 4096,
      url: 'http://hub.test:3000/apk',
      updateAvailable: true,
      bearerAuth: true,
    );

    testWidgets('Update now installs the FRESH manifest, not the stale copy',
        (tester) async {
      final fake = _FakeUpdateService(result: _hubUpdate);
      await tester.pumpWidget(_app(fake));
      await tester.pumpAndSettle();

      fake.result = rebuilt; // the developer rebuilt the APK
      await tester.tap(find.text('Update now'));
      await tester.pumpAndSettle();

      expect(fake.installs, <AppUpdateInfo>[rebuilt],
          reason: 'the stale size/SHA would fail every retry');
    });

    testWidgets('a newer build retitles the dialog and Later silences THAT one',
        (tester) async {
      final fake = _FakeUpdateService(result: _hubUpdate);
      await tester.pumpWidget(_app(fake));
      await tester.pumpAndSettle();

      fake.result = newer;
      await tester.tap(find.text('Update now'));
      await tester.pumpAndSettle();
      expect(find.text('ScreenSync 2.5.6'), findsOneWidget);
      expect(fake.installs, <AppUpdateInfo>[newer]);

      await tester.tap(find.text('Later'));
      await tester.pumpAndSettle();
      expect(fake.dismissed, <int>[34]);
    });

    testWidgets('an unreachable hub falls back to the info it already has',
        (tester) async {
      final fake = _FakeUpdateService(result: _hubUpdate);
      await tester.pumpWidget(_app(fake));
      await tester.pumpAndSettle();

      fake.result = null; // the re-check could not reach the hub
      await tester.tap(find.text('Update now'));
      await tester.pumpAndSettle();

      expect(fake.installs, <AppUpdateInfo>[_hubUpdate]);
    });

    testWidgets('a hub that no longer offers an update says so and installs '
        'nothing', (tester) async {
      final fake = _FakeUpdateService(result: _hubUpdate);
      await tester.pumpWidget(_app(fake));
      await tester.pumpAndSettle();

      fake.result = const AppUpdateInfo(
        versionName: '2.5.4',
        versionCode: 32,
        sha256: '',
        sizeBytes: 0,
        url: 'http://hub.test:3000/apk',
        updateAvailable: false,
        bearerAuth: true,
      );
      await tester.tap(find.text('Update now'));
      await tester.pumpAndSettle();

      expect(fake.installs, isEmpty);
      expect(find.text('No update is available any more.'), findsOneWidget);
    });

    testWidgets('a throwing re-check still installs what the dialog has',
        (tester) async {
      final fake = _FakeUpdateService(result: _hubUpdate);
      await tester.pumpWidget(_app(fake));
      await tester.pumpAndSettle();

      fake.throwOnCheck = true;
      await tester.tap(find.text('Update now'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(fake.installs, <AppUpdateInfo>[_hubUpdate]);
    });
  });

  testWidgets('Later dismisses the dialog and is not re-offered on resume',
      (tester) async {
    final fake = _FakeUpdateService(result: _hubUpdate);
    await tester.pumpWidget(_app(fake));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Later'));
    await tester.pumpAndSettle();
    expect(find.text('ScreenSync 2.5.5'), findsNothing);
    expect(fake.dismissed, <int>[33]);

    await _resume(tester);
    expect(fake.checks, 2, reason: 'resume still checks');
    expect(find.text('ScreenSync 2.5.5'), findsNothing,
        reason: 'but a dismissed build stays quiet');
  });

  testWidgets('does not check on start or resume when auto-check is off',
      (tester) async {
    final fake = _FakeUpdateService(result: _hubUpdate)..autoEnabled = false;
    await tester.pumpWidget(_app(fake));
    await tester.pumpAndSettle();
    await _resume(tester);

    expect(fake.checks, 0);
    expect(find.text('ScreenSync 2.5.5'), findsNothing);
  });

  testWidgets('a failing check never surfaces as an unhandled error',
      (tester) async {
    final fake = _FakeUpdateService(throwOnCheck: true);
    await tester.pumpWidget(_app(fake));
    await tester.pumpAndSettle();
    await _resume(tester);

    expect(tester.takeException(), isNull);
    expect(find.text('home screen'), findsOneWidget);
    expect(fake.checks, 2);
  });

  testWidgets('the dialog fits a 320dp phone at 1.3x text without overflow',
      (tester) async {
    tester.view.physicalSize = const Size(320, 568);
    tester.view.devicePixelRatio = 1.0;
    tester.platformDispatcher.textScaleFactorTestValue = 1.3;
    addTearDown(tester.view.reset);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

    final fake = _FakeUpdateService(result: _hubUpdate);
    await tester.pumpWidget(_app(fake));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Update now'));
    await tester.pumpAndSettle();

    expect(find.text('ScreenSync 2.5.5'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('no update available shows nothing', (tester) async {
    final fake = _FakeUpdateService(result: null);
    await tester.pumpWidget(_app(fake));
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsNothing);
  });
}
