import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:screensync_flutter_project/blocs/screen_capture_bloc.dart';
import 'package:screensync_flutter_project/models/capture_quality.dart';
import 'package:screensync_flutter_project/models/captured_frame.dart';
import 'package:screensync_flutter_project/models/frame_entry.dart';
import 'package:screensync_flutter_project/repositories/capture_cache_repository.dart';
import 'package:screensync_flutter_project/services/capture_pipeline_service.dart';
import 'package:screensync_flutter_project/services/capture_trigger_bridge.dart';
import 'package:screensync_flutter_project/services/settings_service.dart';

import 'support/mirror_test_kit.dart';

/// The bloc was split into mixins (mirror, live hub events, capture sync, hub
/// maintenance). Static analysis cannot see a handler registered twice or not at
/// all, so this builds the real bloc with fakes at the edges and drives the
/// triggers end to end.
class _FakeCache extends CaptureCacheRepository {
  @override
  Future<List<FrameEntry>> recentFrames({int limit = 30}) async => const [];
  @override
  Future<int> unsyncedHubCount() async => 0;
  @override
  Future<List<FrameEntry>> unsyncedHubFrames({int limit = 20}) async =>
      const [];
  @override
  Future<Directory> get thumbsDir async => Directory.systemTemp;
  @override
  Future<int> saveFrame({
    required String filename,
    required String filePath,
    required int width,
    required int height,
    required int byteLength,
    String thumbPath = '',
  }) async =>
      1;
  @override
  Future<void> markSyncedHub(int id) async {}
}

class _CapturingRepo extends FakeScreenRepository {
  _CapturingRepo() : super(url: '');
  bool captureFails = false;

  @override
  Future<CapturedFrame> captureCurrentDisplay({
    CaptureQuality quality = CaptureQuality.inspection,
    NormRect? crop,
    bool allowPrompt = true,
  }) async {
    if (captureFails) throw StateError('Screen capture is not active.');
    return super.captureCurrentDisplay(
        quality: quality, crop: crop, allowPrompt: allowPrompt);
  }
}

File _trigger() =>
    File('${Directory.systemTemp.path}/screensync_trigger_wiring_test');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late FakeProjectionNative native;
  late _CapturingRepo repo;
  late ScreenCaptureBloc bloc;

  /// Writes a trigger the way the overlay engine / Kotlin would. The bridge polls
  /// every 200 ms, so callers wait for the effect with [until], not a fixed nap.
  void writeTrigger(String payload) =>
      _trigger().writeAsStringSync(payload, flush: true);

  Future<void> until(bool Function() cond,
      {Duration timeout = const Duration(seconds: 10)}) async {
    final end = DateTime.now().add(timeout);
    while (!cond()) {
      if (DateTime.now().isAfter(end)) fail('condition not met in $timeout');
      await Future<void>.delayed(const Duration(milliseconds: 25));
    }
  }

  // FlutterOverlayWindow.overlayListener is a single-subscription stream that the
  // plugin owns for the whole process, so the real bloc can only be built once per
  // test isolate: build it once and reset the fakes between tests.
  setUpAll(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auto_discover_hub': false, // no mDNS / LAN scan in a unit test
    });
    await SettingsService.instance.init();
    CaptureTriggerBridge.pathOverride = _trigger().path;
    for (final f in [
      _trigger(),
      File('${_trigger().path}.result'),
    ]) {
      if (f.existsSync()) f.writeAsStringSync('');
    }
    native = FakeProjectionNative()..install();
    native.ready = true;
    // Device-intent channel (pending snaps, notifications, app info): the
    // Kotlin side is absent in a unit test, so answer "nothing pending".
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel('com.screensync.mcp/device'),
            (call) async => call.method == 'drainPendingSnaps'
                ? <Object?>[]
                : null);
    // The EventChannel the projection-state stream listens on.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockStreamHandler(
      const EventChannel('com.screensync.mcp/projection_state'),
      MockStreamHandler.inline(onListen: (arguments, events) {
        events.success(true);
      }),
    );
    repo = _CapturingRepo();
    bloc = ScreenCaptureBloc(
      screenRepository: repo,
      cacheRepository: _FakeCache(),
    );
    await settleBloc();
  });

  tearDownAll(() async {
    await bloc.close();
    native.uninstall();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel('com.screensync.mcp/device'), null);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockStreamHandler(
            const EventChannel('com.screensync.mcp/projection_state'), null);
    CaptureTriggerBridge.pathOverride = null;
  });

  setUp(() async {
    repo
      ..captures = 0
      ..pushes = 0
      ..captureFails = false;
    native
      ..ready = true
      ..grant = true
      ..prepareCalls = 0;
    // The bloc drops triggers that arrive within 1 s of the previous one.
    await Future<void>.delayed(const Duration(milliseconds: 1100));
  });

  test('builds with every mixin registered exactly once', () {
    // A duplicate `on<Event>` would already have thrown in the constructor.
    expect(bloc.state.liveMirrorEnabled, isFalse);
    expect(bloc.metrics, isNotNull);
  });

  test('the native projection-state stream feeds captureReady', () async {
    expect(bloc.state.captureReady, isTrue);
  });


  test('a notification Snap tap is a real capture, and each tap counts',
      () async {
    writeTrigger('snap:1700000000000');
    await until(() => repo.captures == 1);
    await until(() => repo.pushes == 1);

    // The old constant payload was deduped after the first tap. Wait out the
    // bloc's own 1 s debounce, then tap again with a new timestamp.
    await Future<void>.delayed(const Duration(milliseconds: 1100));
    writeTrigger('snap:1700000001500');
    await until(() => repo.captures == 2);
    // Let the whole delivery finish: the bloc is shared, so a straggler would
    // leak into the next test.
    await until(() => repo.pushes == 2);
  });

  test('a delivered frame makes the stream live', () async {
    final before = DateTime.now();
    writeTrigger('snap:1700000002000');
    await until(() => repo.pushes == 1);
    await until(() => (bloc.state.lastFrameAt ?? DateTime(2000)).isAfter(before));
    expect(bloc.state.framesFresh, isTrue);
  });

  test('the notification MCP action is not a capture', () async {
    writeTrigger('mcp:1700000003000');
    // Long enough for several poll cycles: a capture would have started by now.
    await Future<void>.delayed(const Duration(milliseconds: 1200));
    await settleBloc();
    expect(repo.captures, 0);
  });

  test('a bubble tap gets its real outcome written back', () async {
    writeTrigger(jsonEncode(
        {'type': 'CAPTURE', 'source': 'floating_bubble', 'nonce': 4242}));

    final result = await CaptureTriggerBridge.awaitCaptureResult(4242,
        timeout: const Duration(seconds: 10),
        interval: const Duration(milliseconds: 20));
    expect(result, isNotNull);
    expect(result!.ok, isTrue);
  });

  test('a failed capture is reported back as a failure', () async {
    repo.captureFails = true;
    writeTrigger(jsonEncode(
        {'type': 'CAPTURE', 'source': 'floating_bubble', 'nonce': 4243}));

    final result = await CaptureTriggerBridge.awaitCaptureResult(4243,
        timeout: const Duration(seconds: 10),
        interval: const Duration(milliseconds: 20));
    expect(result, isNotNull);
    expect(result!.ok, isFalse);
    expect(result.error, contains('not active'));
  });

  test('turning the mirror on from the bloc goes through consent', () async {
    native.ready = false;
    native.grant = false;

    bloc.add(const SetLiveMirrorEvent(true));
    await settleBloc();

    expect(native.prepareCalls, 1);
    expect(bloc.state.liveMirrorEnabled, isFalse);
  });
}
