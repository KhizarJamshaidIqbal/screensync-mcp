import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:screensync_flutter_project/overlay_bubble.dart';
import 'package:screensync_flutter_project/services/capture_trigger_bridge.dart';

const _overlayChannel = MethodChannel('x-slayer/overlay_channel');
const _overlayControlChannel = MethodChannel('x-slayer/overlay');
const _messenger = BasicMessageChannel<dynamic>(
  'x-slayer/overlay_messenger',
  JSONMessageCodec(),
);

File _triggerFile() =>
    File('${Directory.systemTemp.path}/screensync_trigger_outcome_test');
File _resultFile() => File('${_triggerFile().path}.result');

void _clean() {
  for (final f in [_triggerFile(), _resultFile()]) {
    if (!f.existsSync()) continue;
    try {
      f.deleteSync();
    } on FileSystemException {
      f.writeAsStringSync('', flush: true);
    }
  }
}

/// The bubble used to flash green 500 ms after a tap no matter what happened,
/// and peeked at whatever frame the shared pointer file still held. It now
/// shows the outcome the main engine actually reports.
///
/// The bridge does real file IO while the widget runs on the fake clock, so each
/// step alternates a fake-time pump with a slice of real time.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    CaptureTriggerBridge.pathOverride = _triggerFile().path;
    SharedPreferences.setMockInitialValues(<String, Object>{});
    _clean();
    final binding = TestWidgetsFlutterBinding.instance;
    binding.defaultBinaryMessenger.setMockMethodCallHandler(
        _overlayChannel, (call) async => call.method == 'getOverlayPosition'
            ? <String, double>{'x': 8.0, 'y': 12.0}
            : true);
    binding.defaultBinaryMessenger
        .setMockMethodCallHandler(_overlayControlChannel, (call) async => true);
    binding.defaultBinaryMessenger.setMockDecodedMessageHandler<dynamic>(
        _messenger, (message) async => null);
  });

  tearDown(() {
    CaptureTriggerBridge.pathOverride = null;
    _clean();
    final binding = TestWidgetsFlutterBinding.instance;
    binding.defaultBinaryMessenger.setMockMethodCallHandler(_overlayChannel, null);
    binding.defaultBinaryMessenger
        .setMockMethodCallHandler(_overlayControlChannel, null);
    binding.defaultBinaryMessenger
        .setMockDecodedMessageHandler<dynamic>(_messenger, null);
  });

  Widget harness({Duration timeout = const Duration(seconds: 12)}) =>
      MaterialApp(home: OverlayBubbleWidget(resultTimeout: timeout));

  Future<void> spin(WidgetTester tester, bool Function() done,
      {int maxSteps = 80}) async {
    for (var i = 0; i < maxSteps && !done(); i++) {
      await tester.pump(const Duration(milliseconds: 150));
      await tester
          .runAsync(() => Future<void>.delayed(const Duration(milliseconds: 25)));
    }
  }

  /// Lets the bubble's own reset delays (success/failure flash) run out, then
  /// tears the tree down, so no timer outlives the test.
  Future<void> drainBubbleTimers(WidgetTester tester) async {
    await tester.pump(const Duration(seconds: 3));
    await tester.pumpWidget(const SizedBox.shrink());
  }

  /// Taps the bubble and returns the nonce of the request it wrote.
  Future<Object?> tapBubble(WidgetTester tester) async {
    await tester.tap(find.byIcon(Icons.camera_alt_rounded));
    // The file appears before its content is flushed: wait for the content.
    await spin(
        tester,
        () =>
            _triggerFile().existsSync() &&
            _triggerFile().readAsStringSync().trim().isNotEmpty);
    final payload =
        jsonDecode(_triggerFile().readAsStringSync()) as Map<String, dynamic>;
    return payload['nonce'];
  }

  Future<void> answer(WidgetTester tester, Object? nonce,
      {required bool ok, String? path, String? error}) async {
    await tester.runAsync(() => CaptureTriggerBridge.writeCaptureResult(
        nonce!,
        ok: ok,
        path: path,
        error: error));
  }

  testWidgets('shows the check only after the main engine reports success',
      (tester) async {
    await tester.pumpWidget(harness());
    final nonce = await tapBubble(tester);

    // The request is out, but nobody has answered: it must NOT claim success.
    await spin(tester, () => false, maxSteps: 6);
    expect(find.byIcon(Icons.check_rounded), findsNothing);
    expect(find.byIcon(Icons.hourglass_top_rounded), findsOneWidget);

    await answer(tester, nonce, ok: true, path: '/no/such/frame.png');
    await spin(tester, () => find.byIcon(Icons.check_rounded).evaluate().isNotEmpty);

    expect(find.byIcon(Icons.check_rounded), findsOneWidget);
    expect(find.byIcon(Icons.error_outline_rounded), findsNothing);
    expect(find.text('1'), findsOneWidget, reason: 'a real capture is counted');

    await drainBubbleTimers(tester);
  });

  testWidgets('a failed capture shows a failure, is not counted, never green',
      (tester) async {
    await tester.pumpWidget(harness());
    final nonce = await tapBubble(tester);

    await answer(tester, nonce,
        ok: false, error: 'Screen capture permission was not granted.');
    await spin(tester,
        () => find.byIcon(Icons.error_outline_rounded).evaluate().isNotEmpty);

    expect(find.byIcon(Icons.error_outline_rounded), findsOneWidget);
    expect(find.byIcon(Icons.check_rounded), findsNothing);
    expect(find.text('1'), findsNothing, reason: 'a failed tap is not counted');

    await drainBubbleTimers(tester);
  });

  testWidgets('a result left over from the previous tap is ignored',
      (tester) async {
    await tester.pumpWidget(harness(timeout: const Duration(milliseconds: 500)));
    // Stale success from an earlier request (different nonce).
    await tester.runAsync(() => CaptureTriggerBridge.writeCaptureResult(
        1, ok: true, path: '/old.png'));

    await tapBubble(tester);
    await spin(tester,
        () => find.byIcon(Icons.error_outline_rounded).evaluate().isNotEmpty,
        maxSteps: 120);

    expect(find.byIcon(Icons.check_rounded), findsNothing);
    expect(find.byIcon(Icons.error_outline_rounded), findsOneWidget,
        reason: 'no answer for THIS tap in time reads as a failure');

    await drainBubbleTimers(tester);
  });
}
