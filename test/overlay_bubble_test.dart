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
    File('${Directory.systemTemp.path}/screensync_trigger_overlay_test');

void _clearTriggerFile() {
  final file = _triggerFile();
  if (!file.existsSync()) return;
  try {
    file.deleteSync();
  } on FileSystemException {
    // Windows AV scanners briefly lock fresh temp files; truncate instead.
    file.writeAsStringSync('', flush: true);
  }
}

/// Gesture recognizers run on the fake clock, but the bridge's dart:io
/// writes only complete with real async; drain them after interactions.
Future<void> _drainRealIO(WidgetTester tester) => tester.runAsync(
    () => Future<void>.delayed(const Duration(milliseconds: 400)));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    CaptureTriggerBridge.pathOverride = _triggerFile().path;
    SharedPreferences.setMockInitialValues(<String, Object>{});
    _clearTriggerFile();

    final binding = TestWidgetsFlutterBinding.instance;
    binding.defaultBinaryMessenger.setMockMethodCallHandler(
      _overlayChannel,
      (call) async {
        switch (call.method) {
          case 'checkPermission':
          case 'isOverlayActive':
            return true;
          case 'getOverlayPosition':
            return <String, double>{'x': 8.0, 'y': 12.0};
          case 'moveOverlay':
          case 'closeOverlay':
            return true;
          default:
            return null;
        }
      },
    );
    binding.defaultBinaryMessenger.setMockMethodCallHandler(
      _overlayControlChannel,
      (call) async => true,
    );
    binding.defaultBinaryMessenger.setMockDecodedMessageHandler<dynamic>(
      _messenger,
      (message) async => null,
    );
  });

  tearDown(() {
    CaptureTriggerBridge.pathOverride = null;
    final binding = TestWidgetsFlutterBinding.instance;
    binding.defaultBinaryMessenger
        .setMockMethodCallHandler(_overlayChannel, null);
    binding.defaultBinaryMessenger
        .setMockMethodCallHandler(_overlayControlChannel, null);
    binding.defaultBinaryMessenger
        .setMockDecodedMessageHandler<dynamic>(_messenger, null);
  });

  Widget harness() => const MaterialApp(home: OverlayBubbleWidget());

  testWidgets('bubble renders camera affordance', (tester) async {
    await tester.pumpWidget(harness());
    expect(find.byIcon(Icons.camera_alt_rounded), findsOneWidget);
  });

  testWidgets('tap triggers capture and writes bridge event', (tester) async {
    await tester.pumpWidget(harness());
    await tester.tap(find.byIcon(Icons.camera_alt_rounded));
    await tester.pump();
    await _drainRealIO(tester);
    await tester.pump();

    expect(_triggerFile().existsSync(), isTrue);
    final payload =
        jsonDecode(_triggerFile().readAsStringSync()) as Map<String, dynamic>;
    expect(payload['type'], 'CAPTURE');
    expect(payload['source'], 'floating_bubble');
  });

  testWidgets('long-press opens selector, drag + confirm writes crop event',
      (tester) async {
    await tester.pumpWidget(harness());

    await tester.longPress(find.byIcon(Icons.camera_alt_rounded));
    await tester.pumpAndSettle();
    expect(find.text('Drag a box over the faulty widget, then confirm'),
        findsOneWidget);

    final gesture = await tester.startGesture(const Offset(100, 100));
    await gesture.moveBy(const Offset(160, 200));
    await gesture.up();
    await tester.pump();

    await tester.tap(find.text('Capture region'));
    await tester.pump();
    await _drainRealIO(tester);
    await tester.pump();

    expect(_triggerFile().existsSync(), isTrue);
    final payload =
        jsonDecode(_triggerFile().readAsStringSync()) as Map<String, dynamic>;
    expect(payload['type'], 'CROP_CAPTURE');
    final rect = payload['rect'] as Map<String, dynamic>;
    expect(rect['nx'], closeTo(100 / 800, 0.01));
    expect(rect['ny'], closeTo(100 / 600, 0.01));
  });

  testWidgets('selector cancel returns to bubble without capture',
      (tester) async {
    await tester.pumpWidget(harness());

    await tester.longPress(find.byIcon(Icons.camera_alt_rounded));
    await tester.pumpAndSettle();
    expect(find.text('Cancel'), findsOneWidget);

    await tester.tap(find.text('Cancel'));
    await tester.pump();
    await _drainRealIO(tester);
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.camera_alt_rounded), findsOneWidget);
    final file = _triggerFile();
    expect(!file.existsSync() || file.readAsStringSync().isEmpty, isTrue);
  });
}
