import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:screensync_flutter_project/services/app_update_service.dart';
import 'package:screensync_flutter_project/services/device_intent_service.dart';

import 'update_test_support.dart';

/// The hub-OTA client against a mocked platform channel and a mocked HTTP
/// client: version comparison, error reporting, the installApk status mapping
/// and the opt-out / "Later" preferences. The download itself is covered in
/// update_download_test.dart.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final device = FakeDevice();
  late AppUpdateService service;

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    service = AppUpdateService.forTesting();
    device
      ..reset()
      ..mock();
  });

  tearDown(device.unmock);

  group('version comparison', () {
    test('compares numerically, not lexicographically', () {
      expect(AppUpdateService.compareVersions('2.5.10', '2.5.9'), greaterThan(0));
      expect(AppUpdateService.compareVersions('2.5.9', '2.5.10'), lessThan(0));
      expect(AppUpdateService.compareVersions('2.10.0', '2.9.9'), greaterThan(0));
    });

    test('2.5.4+32 against newer, older and equal', () {
      expect(AppUpdateService.compareVersions('2.5.4+32', '2.5.4+33'), lessThan(0));
      expect(AppUpdateService.compareVersions('2.5.4+32', '2.5.4+31'), greaterThan(0));
      expect(AppUpdateService.compareVersions('2.5.4+32', '2.5.4+32'), 0);
      expect(AppUpdateService.compareVersions('2.5.5+1', '2.5.4+99'), greaterThan(0));
      expect(AppUpdateService.compareVersions('2.5', '2.5.0'), 0);
      expect(AppUpdateService.compareVersions('2.5.4', '2.5.4+0'), 0);
    });

    test('isNewerBuild trusts the versionCode when both are known', () {
      bool newer(int remote, {String name = '2.5.5'}) =>
          AppUpdateService.isNewerBuild(
            installedName: '2.5.4',
            installedCode: 32,
            remoteName: name,
            remoteCode: remote,
          );
      expect(newer(33), isTrue);
      expect(newer(32), isFalse, reason: 'equal build is not an update');
      expect(newer(31), isFalse, reason: 'older build is not an update');
      expect(newer(32, name: '9.9.9'), isFalse,
          reason: 'the name never overrides a known versionCode');
    });

    test('isNewerBuild falls back to the names when a code is unknown', () {
      bool newer(String remote, {int remoteCode = 0}) =>
          AppUpdateService.isNewerBuild(
            installedName: '2.5.4',
            installedCode: 0,
            remoteName: remote,
            remoteCode: remoteCode,
          );
      expect(newer('2.5.10'), isTrue);
      expect(newer('2.5.4'), isFalse);
      expect(newer('2.5.3'), isFalse);
    });
  });

  group('check()', () {
    Map<String, Object?> manifest({
      int code = 33,
      String name = '2.5.5',
      bool available = true,
      bool apkPath = true,
    }) =>
        <String, Object?>{
          'success': true,
          'versionName': name,
          'versionCode': code,
          'sha256': 'ab' * 32,
          'sizeBytes': 100,
          'builtAt': '2026-09-30T00:00:00Z',
          'installedVersionCode': 32,
          'updateAvailable': available,
          'url': 'http://192.168.1.5:3000/apk?token=secret-token',
          if (apkPath) ...<String, Object?>{
            'apkPath': '/apk',
            'versionSource': 'apk-metadata',
          },
        };

    http.Client hub(int status, Object? body, {List<http.Request>? seen}) =>
        MockClient((request) async {
          seen?.add(request);
          return http.Response(jsonEncode(body), status);
        });

    Future<AppUpdateInfo?> run({bool manual = false}) => service.check(
          hubUrl: 'http://hub.test:3000/',
          token: 'tok',
          manual: manual,
        );

    test('a hub with apkPath is downloaded from its own URL with a Bearer header',
        () async {
      final seen = <http.Request>[];
      service.clientFactory = () => hub(200, manifest(), seen: seen);

      final info = await run();

      expect(info, isNotNull);
      expect(info!.updateAvailable, isTrue);
      expect(info.url, 'http://hub.test:3000/apk');
      expect(info.url, isNot(contains('token')));
      expect(info.bearerAuth, isTrue);
      expect(info.versionSource, 'apk-metadata');
      expect(service.lastCheckError, isNull);
      expect(seen.single.headers['Authorization'], 'Bearer tok');
      expect(seen.single.url.queryParameters['versionCode'], '32');
    });

    test('an older hub without apkPath falls back to its own URL', () async {
      service.clientFactory = () => hub(200, manifest(apkPath: false));
      final info = await run();
      expect(info!.bearerAuth, isFalse);
      expect(info.url, 'http://192.168.1.5:3000/apk?token=secret-token');
      expect(info.updateAvailable, isTrue);
    });

    test('a hub claiming an update with the installed versionCode is ignored',
        () async {
      // versionSource "pubspec": the hub guessed. Installing that build would
      // loop forever on "update required".
      service.clientFactory = () => hub(200, manifest(code: 32, name: '2.5.4'));
      final info = await run();
      expect(info, isNotNull);
      expect(info!.updateAvailable, isFalse);
    });

    test('401, 404, 500, offline and timeout each say why', () async {
      service.clientFactory = () => hub(401, <String, Object?>{});
      expect(await run(), isNull);
      expect(service.lastCheckError, contains('rejected the pairing token'));

      service.clientFactory = () => hub(404, <String, Object?>{});
      expect(await run(), isNull);
      expect(service.lastCheckError, contains('no update channel'));

      service.clientFactory = () => hub(500, <String, Object?>{});
      expect(await run(), isNull);
      expect(service.lastCheckError, contains('HTTP 500'));

      service.clientFactory =
          () => MockClient((_) async => throw const SocketException('down'));
      expect(await run(), isNull);
      expect(service.lastCheckError, contains('Could not reach the hub'));

      service.checkTimeout = const Duration(milliseconds: 30);
      service.clientFactory =
          () => MockClient((_) => Completer<http.Response>().future);
      expect(await run(), isNull);
      expect(service.lastCheckError, contains('Could not reach the hub'));
    });

    test('a later successful check clears the error', () async {
      service.clientFactory = () => hub(401, <String, Object?>{});
      await run();
      expect(service.lastCheckError, isNotNull);
      service.clientFactory = () => hub(200, manifest());
      await run();
      expect(service.lastCheckError, isNull);
    });

    test('no hub configured is reported, not silent', () async {
      expect(await service.check(hubUrl: '  ', token: 't'), isNull);
      expect(service.lastCheckError, contains('No hub address'));
    });

    test('Play build: state 3 (update in progress) is offered again', () async {
      device.mock(installer: 'com.android.vending');
      // The default mock has no playUpdateInfo handler -> null -> reported.
      expect(await run(), isNull);
      expect(service.lastCheckError, contains('Google Play'));

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(FakeDevice.channel, (call) async {
        if (call.method == 'installerPackage') return 'com.android.vending';
        if (call.method == 'playUpdateInfo') {
          return <String, Object?>{
            'availableVersionCode': 40,
            'updateAvailability': 3,
          };
        }
        return null;
      });
      service.debugResetPlayOwned();
      final info = await run();
      expect(info, isNotNull);
      expect(info!.playManaged, isTrue);
      expect(info.versionCode, 40);
    });
  });

  group('opt-out and Later', () {
    test('an automatic check does nothing while the switch is off', () async {
      SharedPreferences.setMockInitialValues(
          <String, Object>{AppUpdateService.autoCheckKey: false});
      var requests = 0;
      service.clientFactory = () => MockClient((_) async {
            requests++;
            return http.Response('{}', 200);
          });

      expect(await service.autoCheckEnabled(), isFalse);
      final info = await service.check(hubUrl: 'http://hub.test', token: 't');

      expect(info, isNull);
      expect(requests, 0, reason: 'no request at all');
      expect(device.calls, isEmpty, reason: 'and no native call');
    });

    test('a manual check still runs while the switch is off', () async {
      SharedPreferences.setMockInitialValues(
          <String, Object>{AppUpdateService.autoCheckKey: false});
      var requests = 0;
      service.clientFactory = () => MockClient((_) async {
            requests++;
            return http.Response(
                jsonEncode(<String, Object?>{'versionCode': 32, 'updateAvailable': false}),
                200);
          });
      final info =
          await service.check(hubUrl: 'http://hub.test', token: 't', manual: true);
      expect(requests, 1);
      expect(info, isNotNull);
    });

    test('the switch defaults on and setAutoCheckEnabled persists it', () async {
      expect(await service.autoCheckEnabled(), isTrue);
      await service.setAutoCheckEnabled(false);
      expect(await service.autoCheckEnabled(), isFalse);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getBool('autoUpdateCheck'), isFalse);
      await service.setAutoCheckEnabled(true);
      expect(await service.autoCheckEnabled(), isTrue);
    });

    test('Later silences one versionCode for 24 hours only', () async {
      final t0 = DateTime(2026, 9, 30, 12);
      expect(await service.isDismissed(33, now: t0), isFalse);
      await service.dismiss(33, now: t0);
      expect(await service.isDismissed(33, now: t0), isTrue);
      expect(
          await service.isDismissed(33, now: t0.add(const Duration(hours: 23))),
          isTrue);
      expect(
          await service.isDismissed(33, now: t0.add(const Duration(hours: 25))),
          isFalse);
      expect(await service.isDismissed(34, now: t0), isFalse,
          reason: 'a newer build is never covered by an older Later');
    });
  });

  group('installApk status mapping', () {
    test('the native status strings pass through', () async {
      for (final status in <String>[
        'started',
        'needs_permission',
        'error:no activity found',
      ]) {
        device.mock(installApk: status);
        expect(await DeviceIntentService.installApk('/x.apk'), status);
      }
    });

    test('an older native build answering with a bool is tolerated', () async {
      device.mock(installApk: true);
      expect(await DeviceIntentService.installApk('/x.apk'), 'started');
      device.mock(installApk: false);
      expect(await DeviceIntentService.installApk('/x.apk'),
          startsWith('error:'));
    });

    test('a platform error or a missing plugin becomes an error status',
        () async {
      device.mock(installApk: PlatformException(code: 'x', message: 'boom'));
      expect(await DeviceIntentService.installApk('/x.apk'), 'error:boom');

      device.unmock();
      expect(await DeviceIntentService.installApk('/x.apk'),
          startsWith('error:'));
    });

    test('appVersion and installerPackage survive a missing plugin', () async {
      device.unmock();
      expect((await DeviceIntentService.appVersion()).code, 0);
      expect(await DeviceIntentService.installerPackage(), '');
    });

    test('each status reads as an instruction the user can act on', () {
      expect(AppUpdateService.installResultMessage('started'),
          'Installer opened - confirm the update on screen.');
      expect(AppUpdateService.installResultMessage('needs_permission'),
          contains("Allow 'Install unknown apps' for ScreenSync"));
      // A play-flavor build opens no settings page at all; say what to do then.
      expect(AppUpdateService.installResultMessage('needs_permission'),
          contains('cannot install updates itself'));
      expect(AppUpdateService.installResultMessage('error:disk full'),
          contains('disk full'));
      expect(AppUpdateService.installResultMessage('???'),
          'Could not open the installer.');
    });
  });

}
