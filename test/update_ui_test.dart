import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:screensync_flutter_project/screens/mcp/update_card.dart';
import 'package:screensync_flutter_project/screens/settings/update_section.dart';
import 'package:screensync_flutter_project/services/app_update_service.dart';
import 'package:screensync_flutter_project/services/settings_service.dart';

/// The MCP-tab update card and the Settings update section. The fake overrides
/// only the network / Play edges, so the real `install()` routing is exercised.
class _FakeService extends AppUpdateService {
  _FakeService({this.result, this.error}) : super.forTesting();

  AppUpdateInfo? result;
  String? error;
  bool autoEnabled = true;
  final manualFlags = <bool>[];
  int playStarts = 0;
  int downloads = 0;
  bool? autoWritten;

  @override
  Future<bool> autoCheckEnabled() async => autoEnabled;

  @override
  Future<void> setAutoCheckEnabled(bool enabled) async {
    autoEnabled = enabled;
    autoWritten = enabled;
  }

  @override
  Future<bool> isPlayOwned() async => result?.playManaged ?? false;

  @override
  Future<AppUpdateInfo?> check({
    required String hubUrl,
    required String token,
    bool manual = false,
  }) async {
    manualFlags.add(manual);
    lastCheckError = error;
    return result;
  }

  @override
  Future<String> startPlayUpdate() async {
    playStarts++;
    return 'installed';
  }

  @override
  Future<String> downloadAndInstall(AppUpdateInfo info, {String? token}) async {
    downloads++;
    return 'Installer opened - confirm the update on screen.';
  }
}

const _playUpdate = AppUpdateInfo(
  versionName: '40',
  versionCode: 40,
  sha256: '', // Play-managed: no hash. The old card threw a RangeError here.
  sizeBytes: 0,
  url: '',
  updateAvailable: true,
  playManaged: true,
);

const _hubUpdate = AppUpdateInfo(
  versionName: '2.5.5',
  versionCode: 33,
  sha256: 'abcdef0123456789abcdef0123456789',
  sizeBytes: 3 * 1048576,
  url: 'http://hub.test:3000/apk',
  updateAvailable: true,
  bearerAuth: true,
);

Widget _host(Widget child) => MaterialApp(
      home: Scaffold(body: SingleChildScrollView(child: child)),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('com.screensync.mcp/device');

  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await SettingsService.instance.init();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      switch (call.method) {
        case 'installerPackage':
          return null;
        case 'versionInfo':
          return <String, Object?>{'versionName': '2.5.4', 'versionCode': 32};
      }
      return null;
    });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  group('AppUpdateCard', () {
    testWidgets('a Play-managed update renders without a hash and routes to Play',
        (tester) async {
      final fake = _FakeService(result: _playUpdate);
      await tester.pumpWidget(_host(
          AppUpdateCard(hubUrl: 'http://hub.test', token: 't', service: fake)));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('Update available: 40'), findsOneWidget);
      expect(find.textContaining('SHA-256'), findsNothing);

      await tester.tap(find.text('Update now'));
      await tester.pumpAndSettle();

      expect(fake.playStarts, 1);
      expect(fake.downloads, 0,
          reason: 'a Play build must never take the APK download path');
      expect(find.text('Installed - Google Play restarted the app.'),
          findsOneWidget);
    });

    testWidgets('a hub update shows a short hash and downloads through the hub',
        (tester) async {
      final fake = _FakeService(result: _hubUpdate);
      await tester.pumpWidget(_host(
          AppUpdateCard(hubUrl: 'http://hub.test', token: 't', service: fake)));
      await tester.pumpAndSettle();

      expect(find.text('Update available: 2.5.5'), findsOneWidget);
      expect(find.text('SHA-256 abcdef0123456789...'), findsOneWidget);

      await tester.tap(find.text('Update now'));
      await tester.pumpAndSettle();

      expect(fake.downloads, 1);
      expect(fake.playStarts, 0);
    });

    testWidgets('says why a check failed instead of a generic message',
        (tester) async {
      final fake = _FakeService(
          error: 'The hub rejected the pairing token. Pair this phone again.');
      await tester.pumpWidget(_host(
          AppUpdateCard(hubUrl: 'http://hub.test', token: 't', service: fake)));
      await tester.pumpAndSettle();

      expect(find.text('Could not check for updates'), findsOneWidget);
      expect(find.textContaining('rejected the pairing token'), findsOneWidget);
    });

    testWidgets('with auto-check off it waits for Check now', (tester) async {
      final fake = _FakeService(result: _hubUpdate)..autoEnabled = false;
      await tester.pumpWidget(_host(
          AppUpdateCard(hubUrl: 'http://hub.test', token: 't', service: fake)));
      await tester.pumpAndSettle();

      expect(fake.manualFlags, isEmpty, reason: 'no automatic check');
      expect(find.text('Automatic update checks are off'), findsOneWidget);

      await tester.tap(find.text('Check now'));
      await tester.pumpAndSettle();

      expect(fake.manualFlags, <bool>[true]);
      expect(find.text('Update available: 2.5.5'), findsOneWidget);
    });
  });

  group('UpdateSection', () {
    testWidgets('the switch persists autoUpdateCheck through the real service',
        (tester) async {
      await tester.pumpWidget(_host(
          UpdateSection(hubUrlResolver: (_) => 'http://hub.test')));
      await tester.pumpAndSettle();

      expect(tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
          isTrue,
          reason: 'default is on');
      expect(find.textContaining('Version 2.5.4 (build 32)'), findsOneWidget);
      expect(find.textContaining('your ScreenSync hub'), findsOneWidget);

      await tester.tap(find.byType(Switch));
      await tester.pumpAndSettle();

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getBool('autoUpdateCheck'), isFalse);
      expect(tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
          isFalse);
    });

    testWidgets('Check now runs manually and shows the failure reason',
        (tester) async {
      final fake = _FakeService(error: 'This hub has no update channel.')
        ..autoEnabled = false;
      await tester.pumpWidget(_host(UpdateSection(
          service: fake, hubUrlResolver: (_) => 'http://hub.test')));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Check now'));
      await tester.pumpAndSettle();

      expect(fake.manualFlags, <bool>[true]);
      expect(find.text('This hub has no update channel.'), findsOneWidget);
    });

    testWidgets('Check now with no error says the app is current',
        (tester) async {
      final fake = _FakeService();
      await tester.pumpWidget(_host(UpdateSection(
          service: fake, hubUrlResolver: (_) => 'http://hub.test')));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Check now'));
      await tester.pumpAndSettle();

      expect(find.text('You are on the latest version.'), findsOneWidget);
    });

    testWidgets('an available update can be installed from Settings',
        (tester) async {
      final fake = _FakeService(result: _hubUpdate);
      await tester.pumpWidget(_host(UpdateSection(
          service: fake, hubUrlResolver: (_) => 'http://hub.test')));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Check now'));
      await tester.pumpAndSettle();
      expect(find.text('Update available: 2.5.5'), findsOneWidget);

      await tester.tap(find.text('Update now'));
      await tester.pumpAndSettle();
      expect(fake.downloads, 1);
    });

    testWidgets('fits a 320dp phone with a long failure message',
        (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      final fake = _FakeService(
          error: 'Could not reach the hub. Check the connection and the hub '
              'address, then try again in a moment.');
      await tester.pumpWidget(_host(UpdateSection(
          service: fake, hubUrlResolver: (_) => 'http://hub.test')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Check now'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.textContaining('Could not reach the hub'), findsOneWidget);
    });

    testWidgets('names Google Play as the channel for a store build',
        (tester) async {
      final fake = _FakeService(result: _playUpdate);
      await tester.pumpWidget(_host(UpdateSection(
          service: fake, hubUrlResolver: (_) => 'http://hub.test')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Google Play'), findsWidgets);
    });
  });
}
