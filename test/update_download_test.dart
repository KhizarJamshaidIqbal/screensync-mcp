import 'dart:async';
import 'dart:io';

import 'package:crypto/crypto.dart' as crypto;
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:screensync_flutter_project/services/app_update_service.dart';

import 'update_test_support.dart';

/// The hub-OTA download: timeouts, partial-file cleanup, SHA-256, purge of old
/// APKs, the Bearer header, and the Play-versus-hub routing of install().
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final device = FakeDevice();
  late AppUpdateService service;
  late Directory cache;

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    service = AppUpdateService.forTesting();
    cache = Directory.systemTemp.createTempSync('screensync_update_test');
    service.cacheDirProvider = () async => cache;
    device
      ..reset()
      ..mock();
  });

  tearDown(() {
    device.unmock();
    if (cache.existsSync()) cache.deleteSync(recursive: true);
  });

  group('downloadAndInstall', () {
    final apk = List<int>.generate(4096, (i) => i % 251);
    final apkSha = crypto.sha256.convert(apk).toString();

    AppUpdateInfo info({
      String? sha,
      int? size,
      int code = 33,
      bool bearer = true,
    }) =>
        AppUpdateInfo(
          versionName: '2.5.5',
          versionCode: code,
          sha256: sha ?? apkSha,
          sizeBytes: size ?? apk.length,
          url: 'http://hub.test:3000/apk',
          updateAvailable: true,
          bearerAuth: bearer,
        );

    http.Client apkClient({
      List<int>? bytes,
      int status = 200,
      List<http.BaseRequest>? seen,
    }) =>
        MockClient.streaming((request, _) async {
          seen?.add(request);
          return http.StreamedResponse(
              Stream<List<int>>.value(bytes ?? apk), status);
        });

    List<String> cached() => cache
        .listSync()
        .map((e) => e.uri.pathSegments.last)
        .where((n) => n.endsWith('.apk'))
        .toList();

    test('a verified download opens the installer and keeps the file', () async {
      final seen = <http.BaseRequest>[];
      service.clientFactory = () => apkClient(seen: seen);

      final line = await service.downloadAndInstall(info(), token: 'tok');

      expect(line, 'Installer opened - confirm the update on screen.');
      expect(device.installedPaths.single, endsWith('screensync-33.apk'));
      expect(File(device.installedPaths.single).readAsBytesSync(), apk);
      expect(seen.single.headers['Authorization'], 'Bearer tok');
      expect(seen.single.url.toString(), 'http://hub.test:3000/apk');
    });

    test('a legacy hub URL is fetched as is, without a Bearer header', () async {
      final seen = <http.BaseRequest>[];
      service.clientFactory = () => apkClient(seen: seen);
      final legacy = AppUpdateInfo(
        versionName: '2.5.5',
        versionCode: 33,
        sha256: apkSha,
        sizeBytes: apk.length,
        url: 'http://hub.test:3000/apk?token=t',
        updateAvailable: true,
      );
      await service.downloadAndInstall(legacy);
      expect(seen.single.headers.containsKey('Authorization'), isFalse);
      expect(seen.single.url.queryParameters['token'], 't');
    });

    test('a SHA-256 mismatch deletes the file and never opens the installer',
        () async {
      service.clientFactory = () => apkClient();

      final line = await service.downloadAndInstall(info(sha: '00' * 32));

      expect(line, contains('SHA-256'));
      expect(line, contains('discarded'));
      expect(device.installedPaths, isEmpty);
      expect(device.calls, isNot(contains('installApk')));
      expect(cached(), isEmpty, reason: 'the rejected APK must not stay cached');
    });

    test('the SHA-256 comparison ignores case', () async {
      service.clientFactory = () => apkClient();
      final line = await service.downloadAndInstall(info(sha: apkSha.toUpperCase()));
      expect(line, startsWith('Installer opened'));
    });

    test('a truncated download is deleted and refused', () async {
      service.clientFactory = () => apkClient(bytes: apk.sublist(0, 100));
      final line = await service.downloadAndInstall(info(sha: ''));
      expect(line, startsWith('Download incomplete'));
      expect(device.installedPaths, isEmpty);
      expect(cached(), isEmpty);
    });

    test('a stalled transfer times out and removes the partial file', () async {
      service.stallTimeout = const Duration(milliseconds: 60);
      final never = StreamController<List<int>>();
      never.add(apk.sublist(0, 512));
      service.clientFactory = () => MockClient.streaming(
          (request, _) async => http.StreamedResponse(never.stream, 200));

      final line = await service.downloadAndInstall(info());

      expect(line, contains('timed out'));
      expect(device.installedPaths, isEmpty);
      expect(cached(), isEmpty);
      await never.close();
    });

    test('a hub that never answers times out', () async {
      service.connectTimeout = const Duration(milliseconds: 40);
      service.clientFactory = () => MockClient.streaming(
          (request, _) => Completer<http.StreamedResponse>().future);
      final line = await service.downloadAndInstall(info());
      expect(line, contains('timed out'));
      expect(cached(), isEmpty);
    });

    test('an HTTP error leaves nothing behind and never leaks the URL', () async {
      service.clientFactory = () => apkClient(status: 403);
      final line = await service.downloadAndInstall(info());
      expect(line, 'Download failed (HTTP 403).');
      expect(cached(), isEmpty);

      service.clientFactory = () => MockClient.streaming((request, _) async =>
          throw http.ClientException('refused', request.url));
      final failed = await service.downloadAndInstall(const AppUpdateInfo(
        versionName: '2.5.5',
        versionCode: 33,
        sha256: '',
        sizeBytes: 0,
        url: 'http://hub.test:3000/apk?token=secret-token',
        updateAvailable: true,
      ));
      expect(failed, isNot(contains('secret-token')));
    });

    test('older screensync-*.apk files are purged, other files are not',
        () async {
      File('${cache.path}/screensync-30.apk').writeAsBytesSync(<int>[1]);
      File('${cache.path}/screensync-31.apk').writeAsBytesSync(<int>[1]);
      File('${cache.path}/notes.txt').writeAsStringSync('keep');
      service.clientFactory = () => apkClient();

      await service.downloadAndInstall(info());

      expect(cached(), <String>['screensync-33.apk']);
      expect(File('${cache.path}/notes.txt').existsSync(), isTrue);
    });

    test('a hub without a URL is reported, not attempted', () async {
      final line = await service.downloadAndInstall(const AppUpdateInfo(
        versionName: '2.5.5',
        versionCode: 33,
        sha256: '',
        sizeBytes: 0,
        url: '',
        updateAvailable: true,
      ));
      expect(line, contains('did not publish a download URL'));
    });

    test('needs_permission from the installer is passed on as an instruction',
        () async {
      device.mock(installApk: 'needs_permission');
      service.clientFactory = () => apkClient();
      final line = await service.downloadAndInstall(info());
      expect(line, contains("Allow 'Install unknown apps'"));
    });
  });

  group('install() routing', () {
    test('a Play-managed update goes to Play and never touches the APK path',
        () async {
      device.mock(startPlay: 'canceled');
      service.clientFactory = () => throw StateError('no HTTP for a Play update');
      final line = await service.install(const AppUpdateInfo(
        versionName: '40',
        versionCode: 40,
        sha256: '',
        sizeBytes: 0,
        url: '',
        updateAvailable: true,
        playManaged: true,
      ));
      expect(line, contains('cancelled'));
      expect(device.calls, contains('startPlayUpdate'));
      expect(device.calls, isNot(contains('installApk')));
    });
  });

  test('AppUpdateInfo.shortSha never throws on an empty or short hash', () {
    const empty = AppUpdateInfo(
        versionName: '', versionCode: 1, sha256: '', sizeBytes: 0, url: '', updateAvailable: true);
    const short = AppUpdateInfo(
        versionName: '', versionCode: 1, sha256: 'abc', sizeBytes: 0, url: '', updateAvailable: true);
    expect(empty.shortSha, '');
    expect(short.shortSha, 'abc');
    expect(
        AppUpdateInfo(
                versionName: '',
                versionCode: 1,
                sha256: 'a' * 64,
                sizeBytes: 0,
                url: '',
                updateAvailable: true)
            .shortSha,
        '${'a' * 16}...');
  });
}
