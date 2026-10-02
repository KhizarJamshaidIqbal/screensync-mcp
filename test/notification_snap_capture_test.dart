import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:shared_preferences/shared_preferences.dart';

import 'package:screensync_flutter_project/blocs/screen_capture_bloc.dart';
import 'package:screensync_flutter_project/models/capture_quality.dart';
import 'package:screensync_flutter_project/models/captured_frame.dart';
import 'package:screensync_flutter_project/models/frame_entry.dart';
import 'package:screensync_flutter_project/repositories/capture_cache_repository.dart';
import 'package:screensync_flutter_project/repositories/screen_repository.dart';
import 'package:screensync_flutter_project/repositories/sync_mode.dart';
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

  /// When the hub got each frame (the call starts), and whether it takes it.
  final pushStartedAt = <DateTime>[];
  bool pushOk = true;

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
    pushStartedAt.add(DateTime.now());
    if (!pushOk) return false;
    pushed.add(frame);
    return true;
  }
}

class _FakeCache extends CaptureCacheRepository {
  /// Row ids handed out by [saveFrame], and the ones marked as delivered.
  static const savedId = 42;
  final saves = <DateTime>[];
  final syncedHub = <int>[];

  @override
  Future<int> saveFrame({
    required String filename,
    required String filePath,
    required int width,
    required int height,
    required int byteLength,
    required String thumbPath,
  }) async {
    saves.add(DateTime.now());
    return savedId;
  }

  @override
  Future<void> markSyncedHub(int id) async => syncedHub.add(id);

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

  /// What `captureScreen` hands back. Not an image by default, so saving the
  /// thumbnail fails; a test that needs the frame saved swaps in a real PNG.
  Uint8List frameBytes = Uint8List.fromList(<int>[1, 2, 3]);

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
          return frameBytes;
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
  late _FakeCache cache;
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
    cache = _FakeCache();
    bloc = ScreenCaptureBloc(screenRepository: repo, cacheRepository: cache);
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
    repo.pushStartedAt.clear();
    cache.saves.clear();
    cache.syncedHub.clear();
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
    // The upload no longer follows the save, so success lands a moment after it.
    await until(() => bloc.state.status == CaptureStatus.success);
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

  // Saving the frame (file, thumbnail, history row) and uploading it used to run one
  // after the other, so the hub waited for the thumbnail and the database. The
  // path_provider answer below holds the save up for [persistDelay]: nothing the
  // save does can finish before it, which makes "the upload began first"
  // observable without depending on how fast the machine is.
  group('saving the frame and uploading it run together', () {
    const persistDelay = Duration(milliseconds: 800);
    const pathProvider = MethodChannel('plugins.flutter.io/path_provider');
    late Directory docs;
    late SyncMode originalMode;
    DateTime? saveReleasedAt;
    final statuses = <(CaptureStatus, DateTime)>[];
    StreamSubscription<ScreenCaptureState>? listening;

    DateTime when(CaptureStatus status) =>
        statuses.firstWhere((s) => s.$1 == status).$2;

    setUp(() async {
      docs = Directory.systemTemp.createTempSync('snap_save_test');
      saveReleasedAt = null;
      statuses.clear();
      native.frameBytes =
          Uint8List.fromList(img.encodePng(img.Image(width: 8, height: 8)));
      messenger.setMockMethodCallHandler(pathProvider, (call) async {
        if (call.method != 'getApplicationDocumentsDirectory') return null;
        await Future<void>.delayed(persistDelay);
        saveReleasedAt = DateTime.now();
        return docs.path;
      });
      originalMode = bloc.state.syncMode;
      bloc.add(const ToggleSyncModeEvent(SyncMode.lanMdns));
      await until(() => bloc.state.syncMode == SyncMode.lanMdns);
      listening =
          bloc.stream.listen((s) => statuses.add((s.status, DateTime.now())));
    });

    tearDown(() async {
      await listening?.cancel();
      messenger.setMockMethodCallHandler(pathProvider, null);
      native.frameBytes = Uint8List.fromList(<int>[1, 2, 3]);
      repo.pushOk = true;
      bloc.add(ToggleSyncModeEvent(originalMode));
      await until(() => bloc.state.syncMode == originalMode);
      if (docs.existsSync()) docs.deleteSync(recursive: true);
    });

    test('the hub gets the frame while it is still being saved', () async {
      _trigger().writeAsStringSync('snap:1700000300000', flush: true);
      await until(() => statuses.any((s) => s.$1 == CaptureStatus.success));

      expect(repo.pushStartedAt, hasLength(1));
      expect(saveReleasedAt, isNotNull);
      // The save could not have finished before saveReleasedAt: an upload that
      // began earlier did not wait for it.
      expect(repo.pushStartedAt.single.isBefore(saveReleasedAt!), isTrue);
      // The row is written after that, and the Snap is only done after the row,
      // marked as delivered under the id the save returned.
      expect(cache.saves, hasLength(1));
      expect(cache.syncedHub, [_FakeCache.savedId]);
      expect(when(CaptureStatus.success).isBefore(cache.saves.single), isFalse);
    });

    test('a Snap the hub refuses still waits for the save before it fails',
        () async {
      repo.pushOk = false;
      _trigger().writeAsStringSync('snap:1700000400000', flush: true);
      await until(() => statuses.any((s) => s.$1 == CaptureStatus.failure));

      expect(bloc.state.errorMessage, contains('could not reach'));
      // The upload was refused at once, but the message says the frame is safe
      // locally, so the save has to be done first.
      expect(repo.pushStartedAt.single.isBefore(saveReleasedAt!), isTrue);
      expect(cache.saves, hasLength(1));
      expect(when(CaptureStatus.failure).isBefore(cache.saves.single), isFalse);
      expect(cache.syncedHub, isEmpty);
    });
  });
}
