import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:screensync_flutter_project/blocs/screen_capture_bloc.dart';
import 'package:screensync_flutter_project/models/capture_quality.dart';
import 'package:screensync_flutter_project/models/captured_frame.dart';
import 'package:screensync_flutter_project/models/frame_entry.dart';
import 'package:screensync_flutter_project/repositories/capture_cache_repository.dart';
import 'package:screensync_flutter_project/repositories/screen_repository.dart';
import 'package:screensync_flutter_project/services/capture_trigger_bridge.dart';
import 'package:screensync_flutter_project/services/settings_service.dart';

/// The notification Snap path end to end on the Dart side: trigger file ->
/// bloc -> the real [ScreenRepository] -> the native `captureScreen` call.
/// The frame wait itself is native (FrameWaiter.kt) and is measured on a device;
/// these tests pin the Dart half: it asks for the frame promptly, never raises
/// the consent prompt for a live session, and ends cleanly when the native side
/// gives up on a frame.
class _NoNetworkRepo extends ScreenRepository {
  final pushed = <CapturedFrame>[];

  @override
  String get hubUrl => '';
  @override
  Future<({bool ok, int ms})> pingHubTimed(
          {Duration timeout = const Duration(seconds: 2)}) async =>
      (ok: true, ms: 5);
  @override
  Future<bool> pingHub({Duration timeout = const Duration(seconds: 2)}) async =>
      true;
  @override
  Future<HubAuthStatus> checkHubAuth(
          {Duration timeout = const Duration(seconds: 3)}) async =>
      HubAuthStatus.ok;
  @override
  Future<bool> pushToLocalMcpServer(CapturedFrame frame) async {
    pushed.add(frame);
    return true;
  }
}

class _FakeCache extends CaptureCacheRepository {
  @override
  Future<List<FrameEntry>> recentFrames({int limit = 30}) async => const [];
  @override
  Future<int> unsyncedHubCount() async => 0;
  @override
  Future<Directory> get thumbsDir async => Directory.systemTemp;
}

/// Stands in for the Kotlin capture service on the method channel.
class _Native {
  static const channel = MethodChannel('com.screensync.mcp/media_projection');

  final captureCalledAt = <DateTime>[];
  int prepareCalls = 0;

  /// When set, `captureScreen` fails the way the native frame timeout does.
  String? captureError;

  void install() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      switch (call.method) {
        case 'isCaptureReady':
          return true;
        case 'isPaused':
          return false;
        case 'prepareCapture':
          prepareCalls++;
          return true;
        case 'captureScreen':
          captureCalledAt.add(DateTime.now());
          if (captureError != null) {
            throw PlatformException(
                code: 'capture_failed', message: captureError);
          }
          return Uint8List.fromList(<int>[1, 2, 3]);
        default:
          return null;
      }
    });
  }

  void uninstall() =>
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null);
}

File _trigger() =>
    File('${Directory.systemTemp.path}/screensync_trigger_snap_capture_test');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _Native native;
  late _NoNetworkRepo repo;
  late ScreenCaptureBloc bloc;
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  Future<void> until(bool Function() cond,
      {Duration timeout = const Duration(seconds: 10)}) async {
    final end = DateTime.now().add(timeout);
    while (!cond()) {
      if (DateTime.now().isAfter(end)) fail('condition not met in $timeout');
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
  }

  // The overlay plugin's listener is single-subscription for the process, so
  // the real bloc is built once per test file (see the wiring test).
  setUpAll(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auto_discover_hub': false,
    });
    await SettingsService.instance.init();
    CaptureTriggerBridge.pathOverride = _trigger().path;
    for (final f in [_trigger(), File('${_trigger().path}.result')]) {
      if (f.existsSync()) f.writeAsStringSync('');
    }
    native = _Native()..install();
    messenger.setMockMethodCallHandler(
        const MethodChannel('com.screensync.mcp/device'),
        (call) async =>
            call.method == 'drainPendingSnaps' ? <Object?>[] : null);
    messenger.setMockStreamHandler(
      const EventChannel('com.screensync.mcp/projection_state'),
      MockStreamHandler.inline(
          onListen: (arguments, events) => events.success(true)),
    );
    repo = _NoNetworkRepo();
    bloc = ScreenCaptureBloc(
        screenRepository: repo, cacheRepository: _FakeCache());
    // Native PNG passes straight through, so the fake bytes need no decoding.
    bloc.add(const SetQualityEvent(CaptureQuality.inspection));
    await until(() => bloc.state.quality == CaptureQuality.inspection);
  });

  tearDownAll(() async {
    await bloc.close();
    native.uninstall();
    messenger.setMockMethodCallHandler(
        const MethodChannel('com.screensync.mcp/device'), null);
    messenger.setMockStreamHandler(
        const EventChannel('com.screensync.mcp/projection_state'), null);
    CaptureTriggerBridge.pathOverride = null;
  });

  setUp(() async {
    native
      ..captureCalledAt.clear()
      ..prepareCalls = 0
      ..captureError = null;
    repo.pushed.clear();
    // The bloc drops a trigger within 1 s of the previous one.
    await Future<void>.delayed(const Duration(milliseconds: 1100));
  });

  test('a Snap asks the live session for one frame, promptly and without consent',
      () async {
    final tappedAt = DateTime.now();
    _trigger().writeAsStringSync('snap:1700000100000', flush: true);

    await until(() => repo.pushed.length == 1);
    expect(native.captureCalledAt, hasLength(1));
    expect(native.prepareCalls, 0);
    // The bridge polls every 200 ms; the rest is two channel round trips. Seconds
    // here would mean the Dart side, not the frame wait, is slow.
    expect(native.captureCalledAt.single.difference(tappedAt),
        lessThan(const Duration(seconds: 2)));
    expect(bloc.state.status, CaptureStatus.success);
  });

  test('a native frame timeout ends the Snap as a failure, and the next one works',
      () async {
    native.captureError = 'Timed out waiting for a screen frame.';
    _trigger().writeAsStringSync('snap:1700000200000', flush: true);

    await until(() => bloc.state.status == CaptureStatus.failure);
    expect(bloc.state.errorMessage, contains('Timed out waiting for a screen frame'));
    expect(repo.pushed, isEmpty);

    native.captureError = null;
    await Future<void>.delayed(const Duration(milliseconds: 1100));
    _trigger().writeAsStringSync('snap:1700000201500', flush: true);
    await until(() => repo.pushed.length == 1);
    expect(native.captureCalledAt, hasLength(2));
  });
}
