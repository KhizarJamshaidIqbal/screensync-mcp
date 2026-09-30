import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:screensync_flutter_project/services/capture_trigger_bridge.dart';

File _triggerFile() =>
    File('${Directory.systemTemp.path}/screensync_trigger_snap_test');

void _clean() {
  for (final f in [
    _triggerFile(),
    File('${_triggerFile().path}.result'),
  ]) {
    if (!f.existsSync()) continue;
    try {
      f.deleteSync();
    } on FileSystemException {
      f.writeAsStringSync('', flush: true);
    }
  }
}

const _tick = Duration(milliseconds: 20);
// Many poll cycles (20 ms each): the suite shares a busy machine with others.
const _settle = Duration(milliseconds: 500);

/// The notification "Snap" button wrote the same constant payload every time,
/// so the bridge's exact-payload dedupe swallowed every tap after the first.
/// Each tap now carries `snap:<epochMillis>`, and dedupe stays exact.
void main() {
  setUp(() {
    CaptureTriggerBridge.pathOverride = _triggerFile().path;
    _clean();
  });

  tearDown(() {
    CaptureTriggerBridge.pathOverride = null;
    _clean();
  });

  group('notification snap payloads', () {
    test('two taps with different timestamps are two capture requests',
        () async {
      final events = <Map<String, Object?>>[];
      final sub = CaptureTriggerBridge.watch(interval: _tick).listen(events.add);
      await Future<void>.delayed(_settle);

      _triggerFile().writeAsStringSync('snap:1700000000000', flush: true);
      await Future<void>.delayed(_settle);
      _triggerFile().writeAsStringSync('snap:1700000000450', flush: true);
      await Future<void>.delayed(_settle);

      expect(events, hasLength(2));
      expect(events.map((e) => e['type']), everyElement('NOTIFICATION_SNAP'));
      expect(events.map((e) => e['source']), everyElement('SNAP'));
      expect(events.map((e) => e['payload']),
          ['snap:1700000000000', 'snap:1700000000450']);
      await sub.cancel();
    });

    test('a JSON-quoted raw payload is understood too', () async {
      final events = <Map<String, Object?>>[];
      final sub = CaptureTriggerBridge.watch(interval: _tick).listen(events.add);
      await Future<void>.delayed(_settle);

      _triggerFile()
          .writeAsStringSync(jsonEncode('snap:1700000000000'), flush: true);
      await Future<void>.delayed(_settle);

      expect(events, hasLength(1));
      expect(events.single['type'], 'NOTIFICATION_SNAP');
      await sub.cancel();
    });

    test('the MCP action uses the same unique-payload shape', () async {
      final events = <Map<String, Object?>>[];
      final sub = CaptureTriggerBridge.watch(interval: _tick).listen(events.add);
      await Future<void>.delayed(_settle);

      _triggerFile().writeAsStringSync('mcp:1700000000000', flush: true);
      await Future<void>.delayed(_settle);
      _triggerFile().writeAsStringSync('mcp:1700000000500', flush: true);
      await Future<void>.delayed(_settle);

      expect(events, hasLength(2));
      expect(events.map((e) => e['source']), everyElement('MCP'));
      await sub.cancel();
    });

    test('the very same payload is still deduped exactly', () async {
      final events = <Map<String, Object?>>[];
      final sub = CaptureTriggerBridge.watch(interval: _tick).listen(events.add);
      await Future<void>.delayed(_settle);

      for (var i = 0; i < 3; i++) {
        _triggerFile().writeAsStringSync('snap:1700000000000', flush: true);
        await Future<void>.delayed(_settle);
      }

      expect(events, hasLength(1));
      await sub.cancel();
    });

    test('a JSON snap payload with a unique field is not swallowed either',
        () async {
      final events = <Map<String, Object?>>[];
      final sub = CaptureTriggerBridge.watch(interval: _tick).listen(events.add);
      await Future<void>.delayed(_settle);

      for (final ms in [1, 2]) {
        _triggerFile().writeAsStringSync(
            jsonEncode({'type': 'NOTIFICATION_SNAP', 'source': 'SNAP', 'at': ms}),
            flush: true);
        await Future<void>.delayed(_settle);
      }

      expect(events, hasLength(2));
      await sub.cancel();
    });

    // ScreenCaptureService.writeTriggerFile writes exactly this shape: a JSON
    // object whose "id" is "<kind>:<epochMillis>", unique per tap.
    test('the exact payload the Kotlin notification writes is not swallowed',
        () async {
      final events = <Map<String, Object?>>[];
      final sub = CaptureTriggerBridge.watch(interval: _tick).listen(events.add);
      await Future<void>.delayed(_settle);

      const payloads = [
        '{"type":"NOTIFICATION_SNAP","source":"SNAP","id":"snap:1727712000000"}',
        '{"type":"NOTIFICATION_SNAP","source":"SNAP","id":"snap:1727712000450"}',
        '{"type":"NOTIFICATION_SNAP","source":"MCP","id":"mcp:1727712001000"}',
      ];
      for (final payload in payloads) {
        _triggerFile().writeAsStringSync(payload, flush: true);
        await Future<void>.delayed(_settle);
      }

      expect(events.map((e) => e['source']), ['SNAP', 'SNAP', 'MCP']);
      expect(events.map((e) => e['id']),
          ['snap:1727712000000', 'snap:1727712000450', 'mcp:1727712001000']);
      await sub.cancel();
    });
  });

  group('stale triggers', () {
    test('a trigger left by an earlier session is not replayed on start',
        () async {
      // e.g. yesterday's Snap tap, or a bubble tap from before a restart.
      _triggerFile().writeAsStringSync('snap:1600000000000', flush: true);

      final events = <Map<String, Object?>>[];
      final sub = CaptureTriggerBridge.watch(interval: _tick).listen(events.add);
      await Future<void>.delayed(_settle);
      expect(events, isEmpty, reason: 'history is not a capture request');

      _triggerFile().writeAsStringSync('snap:1700000000000', flush: true);
      await Future<void>.delayed(_settle);
      expect(events, hasLength(1));
      await sub.cancel();
    });
  });

  group('capture result channel', () {
    test('sendCapture returns the nonce it wrote', () async {
      final nonce = await CaptureTriggerBridge.sendCapture();
      final written =
          jsonDecode(_triggerFile().readAsStringSync()) as Map<String, dynamic>;
      expect(written['nonce'], nonce);
    });

    test('the bubble receives the outcome of its own request', () async {
      final nonce = await CaptureTriggerBridge.sendCapture();
      await CaptureTriggerBridge.writeCaptureResult(nonce,
          ok: true, path: '/data/frame_1.png');

      final result = await CaptureTriggerBridge.awaitCaptureResult(nonce,
          timeout: const Duration(seconds: 2),
          interval: const Duration(milliseconds: 20));

      expect(result, isNotNull);
      expect(result!.ok, isTrue);
      expect(result.path, '/data/frame_1.png');
    });

    test('a failed capture is reported as a failure with its reason',
        () async {
      final nonce = await CaptureTriggerBridge.sendCapture();
      await CaptureTriggerBridge.writeCaptureResult(nonce,
          ok: false, error: 'Screen capture permission was not granted.');

      final result = await CaptureTriggerBridge.awaitCaptureResult(nonce,
          timeout: const Duration(seconds: 2),
          interval: const Duration(milliseconds: 20));

      expect(result!.ok, isFalse);
      expect(result.error, contains('not granted'));
    });

    test('the previous frame\'s result is never mistaken for this one',
        () async {
      final first = await CaptureTriggerBridge.sendCapture();
      await CaptureTriggerBridge.writeCaptureResult(first,
          ok: true, path: '/data/old.png');

      final second = await CaptureTriggerBridge.sendCapture();
      expect(second, isNot(first));
      final result = await CaptureTriggerBridge.awaitCaptureResult(second,
          timeout: const Duration(milliseconds: 250),
          interval: const Duration(milliseconds: 20));

      expect(result, isNull,
          reason: 'no answer for this request yet, so no false success');
    });

    test('no answer at all times out instead of hanging', () async {
      final nonce = await CaptureTriggerBridge.sendCapture();
      final result = await CaptureTriggerBridge.awaitCaptureResult(nonce,
          timeout: const Duration(milliseconds: 150),
          interval: const Duration(milliseconds: 20));
      expect(result, isNull);
    });
  });
}
