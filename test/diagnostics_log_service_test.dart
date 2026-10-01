import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:screensync_flutter_project/models/telemetry_event.dart';
import 'package:screensync_flutter_project/services/diagnostics_log_service.dart';
import 'package:screensync_flutter_project/services/diagnostics_share_service.dart';

/// The on-device diagnostics log: rotation at its size cap, and redaction of
/// the pairing token and bearer credentials before anything reaches disk.
void main() {
  late Directory tmp;

  setUp(() => tmp = Directory.systemTemp.createTempSync('ss_diag_'));
  tearDown(() {
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
  });

  DiagnosticsLogService service({int maxBytes = 512 * 1024}) =>
      DiagnosticsLogService(
        baseDir: () async => tmp,
        maxBytes: maxBytes,
        clock: () => DateTime.utc(2026, 10, 1, 9, 30, 15),
      );

  File logFile(String name) => File('${tmp.path}/logs/$name');

  group('format', () {
    test('one line per entry: ISO time, tag, message', () async {
      final log = service();
      await log.log('hub', 'reachable in 42ms');
      final text = logFile(DiagnosticsLogService.fileName).readAsStringSync();
      expect(text, '2026-10-01T09:30:15.000Z hub reachable in 42ms\n');
    });

    test('a multi-line message keeps every extra line indented', () async {
      final log = service();
      await log.logError('flutter', StateError('boom'),
          StackTrace.fromString('#0 main (a.dart:1)\n#1 run (b.dart:2)'));
      final lines =
          logFile(DiagnosticsLogService.fileName).readAsLinesSync();
      expect(lines.first,
          startsWith('2026-10-01T09:30:15.000Z flutter Bad state: boom'));
      expect(lines.skip(1), everyElement(startsWith('  #')));
    });

    test('a telemetry event is mirrored with kind, outcome and latency',
        () async {
      final log = service();
      await log.logTelemetry(TelemetryEvent(
        kind: 'upload',
        label: 'LAN push frame_1.png (120 KB)',
        durationMs: 87,
        ok: true,
        timestamp: DateTime.utc(2026),
      ));
      expect(logFile(DiagnosticsLogService.fileName).readAsStringSync(),
          contains('telemetry upload ok 87ms LAN push frame_1.png (120 KB)'));
    });
  });

  group('rotation', () {
    test('rotates when the next entry would cross the cap, keeps 2 files',
        () async {
      const cap = 400;
      final log = service(maxBytes: cap);
      // Each entry is ~60 bytes: 40 of them is six times the cap.
      for (var i = 0; i < 40; i++) {
        await log.log('test', 'entry ${i.toString().padLeft(3, '0')} padding');
      }
      final current = logFile(DiagnosticsLogService.fileName);
      final rotated = logFile(DiagnosticsLogService.rotatedName);
      expect(current.lengthSync(), lessThanOrEqualTo(cap));
      expect(rotated.lengthSync(), lessThanOrEqualTo(cap));
      expect(rotated.lengthSync(), greaterThan(cap - 70),
          reason: 'a file rotates only once it is (nearly) full');
      expect(Directory('${tmp.path}/logs').listSync(), hasLength(2),
          reason: 'never more than app.log and app.log.1');

      // Newest in app.log, the one before in app.log.1, the oldest gone.
      expect(current.readAsStringSync(), contains('entry 039'));
      expect(rotated.readAsStringSync(), isNot(contains('entry 039')));
      final all = await log.tail();
      expect(all, isNot(contains('entry 000')));
      expect(all.indexOf('entry 038'), lessThan(all.indexOf('entry 039')),
          reason: 'tail reads oldest first');
    });

    test('below the cap nothing rotates', () async {
      final log = service(maxBytes: 4096);
      for (var i = 0; i < 10; i++) {
        await log.log('test', 'entry $i');
      }
      expect(logFile(DiagnosticsLogService.rotatedName).existsSync(), isFalse);
    });

    test('a fresh service picks up the size of an existing file', () async {
      const cap = 300;
      // 81-byte entries: three fit (243 bytes), a fourth would not.
      for (var i = 0; i < 3; i++) {
        await service(maxBytes: cap).log('test', 'x' * 50);
      }
      final before = logFile(DiagnosticsLogService.fileName).lengthSync();
      expect(before, 243);
      expect(logFile(DiagnosticsLogService.rotatedName).existsSync(), isFalse);
      await service(maxBytes: cap).log('test', 'y' * 50);
      expect(logFile(DiagnosticsLogService.rotatedName).existsSync(), isTrue);
      expect(logFile(DiagnosticsLogService.fileName).lengthSync(),
          lessThanOrEqualTo(cap));
    });

    test('tail returns only the newest bytes, starting at a whole line',
        () async {
      final log = service();
      for (var i = 0; i < 50; i++) {
        await log.log('test', 'line $i');
      }
      final tail = await log.tail(maxBytes: 200);
      expect(tail.length, lessThanOrEqualTo(200));
      expect(tail, startsWith('2026-'));
      expect(tail, contains('line 49'));
      expect(tail, isNot(contains('line 0\n')));
    });
  });

  group('redaction', () {
    const token = 'k3y-9f8e7d6c5b4a';

    test('the stored token and "Bearer x" never reach the file', () async {
      final log = service()..secrets = () => [token];
      await log.log('hub', 'GET /api/screens Authorization: Bearer x');
      await log.log('hub', 'pairing with $token failed');
      await log.log('hub', 'refused http://10.0.0.2:3000/apk?token=$token&v=2');

      final text = logFile(DiagnosticsLogService.fileName).readAsStringSync();
      expect(text, isNot(contains(token)));
      expect(text, isNot(contains('Bearer x')));
      expect(text, contains('Bearer [redacted]'));
      expect(text, contains('pairing with [redacted] failed'));
      expect(text, contains('?token=[redacted]&v=2'));
    });

    test('a token of a remembered hub and any token= parameter are scrubbed',
        () async {
      final log = service()..secrets = () => [token, 'old-hub-token-123'];
      await log.log('hub', 'old-hub-token-123 / Bearer  abc.def / '
          'http://h/#access_token=zzz');
      final text = logFile(DiagnosticsLogService.fileName).readAsStringSync();
      expect(text, isNot(contains('old-hub-token-123')));
      expect(text, isNot(contains('abc.def')));
      expect(text, isNot(contains('zzz')));
    });

    test('redaction runs before the length cap, so no piece of a token leaks',
        () async {
      final log = service()..secrets = () => [token];
      const cut = DiagnosticsLogService.maxEntryChars - 5;
      await log.log('hub', '${'a' * cut}$token');
      expect(logFile(DiagnosticsLogService.fileName).readAsStringSync(),
          isNot(contains(token.substring(0, 5))));
    });

    test('tail redacts again with the current secrets', () async {
      final log = service();
      await log.log('hub', 'next token will be $token');
      log.secrets = () => [token];
      expect(await log.tail(), isNot(contains(token)));
    });

    test('a failing secrets lookup still redacts bearer credentials', () async {
      final log = service()..secrets = () => throw StateError('not loaded');
      await log.log('hub', 'Authorization: Bearer x');
      expect(logFile(DiagnosticsLogService.fileName).readAsStringSync(),
          contains('Bearer [redacted]'));
    });
  });

  test('without storage it never throws and the tail is empty', () async {
    final log = DiagnosticsLogService(
        baseDir: () async => throw const FileSystemException('no storage'));
    await log.log('app', 'start');
    await log.logError('flutter', Exception('x'), StackTrace.current);
    expect(await log.tail(), isEmpty);
  });

  group('share report', () {
    test('holds version, device, hub host only, telemetry and the log tail',
        () async {
      const token = 'k3y-9f8e7d6c5b4a';
      final log = service()..secrets = () => [token];
      await log.log('app', 'start 2.5.7 (35)');
      String? shared;
      final share = DiagnosticsShareService(
        log: log,
        appVersion: () async => '2.5.7 (35)',
        deviceModel: () async => 'Google Pixel 7 (Android 14, SDK 34)',
        cacheDir: () async => tmp,
        openShareSheet: (path) async {
          shared = path;
          return true;
        },
        clock: () => DateTime.utc(2026, 10, 1),
      );

      final ok = await share.share(
        hubUrl: 'http://user:$token@192.168.1.10:3000/pair?token=$token#$token',
        telemetry: [
          for (var i = 0; i < 35; i++)
            TelemetryEvent(
              kind: 'upload',
              label: 'push $i',
              durationMs: i,
              ok: i.isEven,
              timestamp: DateTime.utc(2026, 10, 1),
            ),
        ],
      );

      expect(ok, isTrue);
      final file = File('${tmp.path}/share/diagnostics.txt');
      expect(shared, file.path);
      final text = file.readAsStringSync();
      expect(text, contains('App version: 2.5.7 (35)'));
      expect(text, contains('Device: Google Pixel 7 (Android 14, SDK 34)'));
      expect(text, contains('Hub host: 192.168.1.10\n'));
      expect(text, contains('Telemetry (last 30, newest first)'));
      expect(text, contains('push 29'));
      expect(text, isNot(contains('push 30')));
      expect(text, contains('app start 2.5.7 (35)'));
      expect(text, isNot(contains(token)));
    });

    test('a failure to write or share answers false instead of throwing',
        () async {
      final share = DiagnosticsShareService(
        log: service(),
        appVersion: () async => '1',
        deviceModel: () async => 'x',
        cacheDir: () async => throw const FileSystemException('full'),
        openShareSheet: (_) async => true,
      );
      expect(await share.share(hubUrl: '', telemetry: const []), isFalse);
    });

    test('hubHost keeps the host and nothing else', () {
      expect(DiagnosticsShareService.hubHost('http://10.0.0.5:3000/x?token=1'),
          '10.0.0.5');
      expect(DiagnosticsShareService.hubHost(''), '(not set)');
    });
  });
}
