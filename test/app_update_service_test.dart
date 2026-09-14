import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:screensync_flutter_project/services/app_update_service.dart';

/// The two update channels must never be mixed, and the choice is made from the
/// install source. These tests drive the real routing logic through a mocked
/// platform channel: the device under test is a sideloaded build, so the Play
/// branch cannot be reached by hand.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('com.screensync.mcp/device');

  void mock(Future<Object?> Function(MethodCall call)? handler) {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, handler);
  }

  setUp(() => AppUpdateService.instance.debugResetPlayOwned());
  tearDown(() {
    mock(null);
    AppUpdateService.instance.debugResetPlayOwned();
  });

  test('sideloaded build never asks Play', () async {
    final asked = <String>[];
    mock((call) async {
      asked.add(call.method);
      if (call.method == 'installerPackage') return null; // no installer = sideload
      return null;
    });
    final info = await AppUpdateService.instance
        .check(hubUrl: '', token: 'anything');
    expect(info, isNull);
    expect(asked, contains('installerPackage'));
    expect(asked, isNot(contains('playUpdateInfo')));
  });

  test('Play build with UPDATE_AVAILABLE becomes a playManaged update', () async {
    mock((call) async {
      switch (call.method) {
        case 'installerPackage':
          return 'com.android.vending';
        case 'playUpdateInfo':
          return <String, Object?>{
            'availableVersionCode': 42,
            'updateAvailability': 2, // UPDATE_AVAILABLE
            'immediateAllowed': true,
            'installStatus': 0,
          };
      }
      return null;
    });
    final info = await AppUpdateService.instance
        .check(hubUrl: 'http://192.168.1.3:3000', token: 'x');
    expect(info, isNotNull);
    expect(info!.playManaged, isTrue);
    expect(info.versionCode, 42);
    expect(info.updateAvailable, isTrue);
    expect(info.url, isEmpty, reason: 'Play performs the install itself');
  });

  test('Play build with no newer version reports nothing', () async {
    mock((call) async {
      switch (call.method) {
        case 'installerPackage':
          return 'com.android.vending';
        case 'playUpdateInfo':
          return <String, Object?>{
            'availableVersionCode': 0,
            'updateAvailability': 1, // UPDATE_NOT_AVAILABLE
          };
      }
      return null;
    });
    expect(
      await AppUpdateService.instance
          .check(hubUrl: 'http://192.168.1.3:3000', token: 'x'),
      isNull,
    );
  });

  test('Play build where Play cannot be asked reports nothing', () async {
    mock((call) async =>
        call.method == 'installerPackage' ? 'com.android.vending' : null);
    expect(
      await AppUpdateService.instance
          .check(hubUrl: 'http://192.168.1.3:3000', token: 'x'),
      isNull,
      reason: 'null means unknown, never "up to date"',
    );
  });
}

