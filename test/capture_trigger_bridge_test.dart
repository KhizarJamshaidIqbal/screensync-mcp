import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:screensync_flutter_project/services/capture_trigger_bridge.dart';

File _triggerFile() =>
    File('${Directory.systemTemp.path}/screensync_trigger_bridge_test');

void main() {
  setUp(() {
    CaptureTriggerBridge.pathOverride = _triggerFile().path;
    final file = _triggerFile();
    if (file.existsSync()) {
      try {
        file.deleteSync();
      } on FileSystemException {
        file.writeAsStringSync('', flush: true);
      }
    }
  });

  tearDown(() {
    CaptureTriggerBridge.pathOverride = null;
  });

  test('sendCapture writes a CAPTURE payload', () async {
    await CaptureTriggerBridge.sendCapture();
    final raw = _triggerFile().readAsStringSync();
    expect(raw, contains('"type":"CAPTURE"'));
    expect(raw, contains('"source":"floating_bubble"'));
  });

  test('sendCrop writes normalized rect payload', () async {
    await CaptureTriggerBridge.sendCrop(0.1, 0.2, 0.3, 0.4);
    final raw = _triggerFile().readAsStringSync();
    expect(raw, contains('"type":"CROP_CAPTURE"'));
    expect(raw, contains('"nx":0.1'));
    expect(raw, contains('"nw":0.3'));
  });

  test('watch emits new events and stops on cancel', () async {
    final events = <Map<String, Object?>>[];
    final sub = CaptureTriggerBridge.watch(
      interval: const Duration(milliseconds: 20),
    ).listen(events.add);

    await Future<void>.delayed(const Duration(milliseconds: 50));
    await CaptureTriggerBridge.sendCapture();
    await Future<void>.delayed(const Duration(milliseconds: 150));

    expect(events, isNotEmpty);
    expect(events.first['type'], 'CAPTURE');

    await sub.cancel();
    final countAtCancel = events.length;
    await CaptureTriggerBridge.sendCrop(0.5, 0.5, 0.1, 0.1);
    await Future<void>.delayed(const Duration(milliseconds: 150));
    // Cancellation-aware loop: no further emissions after cancel.
    expect(events.length, countAtCancel);
  });

  test('watch dedupes identical payloads', () async {
    final events = <Map<String, Object?>>[];
    final sub = CaptureTriggerBridge.watch(
      interval: const Duration(milliseconds: 20),
    ).listen(events.add);

    await Future<void>.delayed(const Duration(milliseconds: 50));
    await CaptureTriggerBridge.sendCapture();
    await Future<void>.delayed(const Duration(milliseconds: 200));
    final afterFirst = events.length;
    // Re-sending the exact same raw payload must not re-emit (dedupe);
    // sendCapture() itself always differs thanks to its nonce.
    await CaptureTriggerBridge.send(const {'type': 'PING'});
    await Future<void>.delayed(const Duration(milliseconds: 200));
    await CaptureTriggerBridge.send(const {'type': 'PING'});
    await Future<void>.delayed(const Duration(milliseconds: 200));

    expect(events.where((e) => e['type'] == 'PING').length, lessThanOrEqualTo(1));
    expect(events.length, greaterThan(afterFirst));
    await sub.cancel();
  });
}
