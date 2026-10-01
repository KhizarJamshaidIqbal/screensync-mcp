import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:screensync_flutter_project/blocs/live_mirror_mixin.dart';
import 'package:screensync_flutter_project/blocs/screen_capture_event.dart';
import 'package:screensync_flutter_project/blocs/screen_capture_state.dart';
import 'package:screensync_flutter_project/services/media_projection_service.dart';
import 'package:screensync_flutter_project/services/settings_service.dart';

import 'support/mirror_test_kit.dart';

/// The live mirror used to turn itself "on" without ever asking for screen
/// capture consent, then skip every tick silently forever. These tests pin the
/// replacement behaviour: consent on enable, never from the timer, and a
/// counted, visible skip.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late FakeProjectionNative native;
  late FakeScreenRepository repo;
  late MirrorTestBloc bloc;

  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await SettingsService.instance.init();
    native = FakeProjectionNative()..install();
    repo = FakeScreenRepository();
    bloc = MirrorTestBloc(repo);
  });

  tearDown(() async {
    await bloc.close();
    native.uninstall();
  });

  group('enabling the mirror asks for consent', () {
    test('a refusal leaves the switch off and says why', () async {
      native.grant = false;

      bloc.add(const SetLiveMirrorEvent(true));
      await settleBloc();

      expect(native.prepareCalls, 1, reason: 'consent is requested on enable');
      expect(bloc.state.liveMirrorEnabled, isFalse);
      expect(bloc.state.consentPending, isFalse);
      expect(SettingsService.instance.liveMirrorEnabled, isFalse);
      expect(bloc.state.errorMessage, contains('not allowed'));
      expect(bloc.state.errorMessage, isNot(contains('a frame is pushed')));

      // No timer was started: a tick would have captured a frame.
      await bloc.liveMirrorTick();
      expect(repo.captures, 0);
    });

    test('a native permission_timeout is a refusal, not a hang', () async {
      native.failWithCode = 'permission_timeout';

      bloc.add(const SetLiveMirrorEvent(true));
      await settleBloc();

      expect(bloc.state.liveMirrorEnabled, isFalse);
      expect(SettingsService.instance.liveMirrorEnabled, isFalse);
      expect(bloc.state.errorMessage, isNotNull);
      expect(bloc.state.consentPending, isFalse);
    });

    test('permission_request_active turns the switch back off', () async {
      native.failWithCode = 'permission_request_active';

      bloc.add(const SetLiveMirrorEvent(true));
      await settleBloc();

      expect(bloc.state.liveMirrorEnabled, isFalse);
      expect(bloc.state.errorMessage, contains('already open'));
    });

    test('any other error also leaves it off', () async {
      native.failWithCode = 'boom';

      bloc.add(const SetLiveMirrorEvent(true));
      await settleBloc();

      expect(bloc.state.liveMirrorEnabled, isFalse);
      expect(SettingsService.instance.liveMirrorEnabled, isFalse);
      expect(bloc.state.errorMessage, contains('Could not start'));
    });

    test('a grant turns it on and only then claims frames are pushed',
        () async {
      bloc.add(const SetLiveMirrorEvent(true));
      await settleBloc();

      expect(bloc.state.liveMirrorEnabled, isTrue);
      expect(bloc.state.captureReady, isTrue);
      expect(SettingsService.instance.liveMirrorEnabled, isTrue);
      expect(bloc.state.errorMessage, contains('a frame is pushed every'));
    });

    test('tapping again while the prompt is open does not stack prompts',
        () async {
      bloc
        ..add(const SetLiveMirrorEvent(true))
        ..add(const SetLiveMirrorEvent(true));
      await settleBloc();

      expect(native.prepareCalls, 1);
    });

    test('turning it off clears the waiting flag and the message', () async {
      bloc.add(const SetLiveMirrorEvent(true));
      await settleBloc();
      bloc.add(const MirrorWaitingChangedEvent(true));
      await settleBloc();

      bloc.add(const SetLiveMirrorEvent(false));
      await settleBloc();

      expect(bloc.state.liveMirrorEnabled, isFalse);
      expect(bloc.state.mirrorWaiting, isFalse);
      expect(bloc.state.errorMessage, isNull);
      expect(SettingsService.instance.liveMirrorEnabled, isFalse);
    });
  });

  group('switching the mirror off releases the session it asked for', () {
    test('a session the mirror\'s own prompt started is stopped', () async {
      bloc.add(const SetLiveMirrorEvent(true));
      await settleBloc();
      expect(native.ready, isTrue);

      bloc.add(const SetLiveMirrorEvent(false));
      await settleBloc();

      expect(native.stopCalls, 1);
      expect(native.ready, isFalse);
      expect(bloc.state.captureReady, isFalse);
    });

    test('a self-stop after repeated failures releases it too', () async {
      bloc.add(const SetLiveMirrorEvent(true));
      await settleBloc();
      repo.pushOk = false;

      for (var i = 0; i < 3; i++) {
        await bloc.liveMirrorTick();
      }
      await settleBloc();

      expect(bloc.state.liveMirrorEnabled, isFalse);
      expect(native.stopCalls, 1);
    });

    test('a session that was already live is left alone', () async {
      native.ready = true; // the bubble (or an earlier grant) owns it

      bloc.add(const SetLiveMirrorEvent(true));
      await settleBloc();
      expect(native.prepareCalls, 0, reason: 'no prompt, it was ready');

      bloc.add(const SetLiveMirrorEvent(false));
      await settleBloc();

      expect(native.stopCalls, 0);
      expect(native.ready, isTrue);
    });

    test('a running bubble keeps the session when the mirror goes off',
        () async {
      bloc.add(const SetLiveMirrorEvent(true));
      await settleBloc();
      // The bubble came up later and now relies on the same session.
      bloc.add(const OverlayBubbleToggledExternally(true));
      await settleBloc();

      bloc.add(const SetLiveMirrorEvent(false));
      await settleBloc();

      expect(native.stopCalls, 0);
      expect(native.ready, isTrue);
    });

    test('a session someone else ended is not stopped a second time',
        () async {
      bloc.add(const SetLiveMirrorEvent(true));
      await settleBloc();
      bloc.projection.add(false); // Android revoked it
      await settleBloc();

      bloc.add(const SetLiveMirrorEvent(false));
      await settleBloc();

      expect(native.stopCalls, 0);
    });

    test('the grant button for a bubble does not make the mirror its owner',
        () async {
      bloc.add(const GrantScreenCaptureEvent()); // mirror is off here
      await settleBloc();
      bloc.add(const SetLiveMirrorEvent(true));
      await settleBloc();
      bloc.add(const SetLiveMirrorEvent(false));
      await settleBloc();

      expect(native.stopCalls, 0);
    });
  });

  group('the timer never prompts and counts its skips', () {
    test('five not-ready ticks record ONE telemetry entry and raise the flag',
        () async {
      native.ready = false;

      for (var i = 1; i <= 4; i++) {
        await bloc.liveMirrorTick();
        await settleBloc();
        expect(bloc.state.mirrorWaiting, isFalse,
            reason: 'tick $i is below the threshold');
        expect(bloc.telemetry, isEmpty);
      }

      await bloc.liveMirrorTick();
      await settleBloc();
      expect(bloc.state.mirrorWaiting, isTrue);
      expect(bloc.telemetry, hasLength(1));
      expect(bloc.telemetry.single, contains('screen capture is not active'));

      // The stall is reported once, not on every further tick.
      for (var i = 0; i < 4; i++) {
        await bloc.liveMirrorTick();
      }
      await settleBloc();
      expect(bloc.telemetry, hasLength(1));

      expect(native.prepareCalls, 0, reason: 'a timer must never prompt');
      expect(repo.captures, 0);
    });

    test('a stalled mirror stays enabled (the timer stays alive)', () async {
      bloc.add(const SetLiveMirrorEvent(true));
      await settleBloc();
      native.ready = false;
      for (var i = 0; i < 6; i++) {
        await bloc.liveMirrorTick();
      }
      await settleBloc();

      expect(bloc.state.mirrorWaiting, isTrue);
      expect(bloc.state.liveMirrorEnabled, isTrue);
      expect(SettingsService.instance.liveMirrorEnabled, isTrue);
    });

    test('the first successful push clears the flag; a new stall re-reports',
        () async {
      native.ready = false;
      for (var i = 0; i < 5; i++) {
        await bloc.liveMirrorTick();
      }
      await settleBloc();
      expect(bloc.state.mirrorWaiting, isTrue);

      native.ready = true; // consent granted from the UI
      await bloc.liveMirrorTick();
      await settleBloc();

      expect(repo.pushes, 1);
      expect(repo.capturePrompts, [false],
          reason: 'the mirror captures with prompting disabled');
      expect(bloc.state.mirrorWaiting, isFalse);
      expect(bloc.state.captureReady, isTrue);
      expect(bloc.state.lastFrameAt, isNotNull);

      native.ready = false; // Android ended the session again
      for (var i = 0; i < 5; i++) {
        await bloc.liveMirrorTick();
      }
      await settleBloc();
      expect(bloc.state.mirrorWaiting, isTrue);
      expect(bloc.telemetry, hasLength(2));
    });

    test('an offline hub is not counted as a missing capture session',
        () async {
      final offline = MirrorTestBloc(
        repo,
        initial: const ScreenCaptureState(hubOnline: false, hubUrl: 'http://x'),
      );
      native.ready = false;
      for (var i = 0; i < 8; i++) {
        await offline.liveMirrorTick();
      }
      await settleBloc();

      expect(offline.state.mirrorWaiting, isFalse);
      expect(offline.telemetry, isEmpty);
      await offline.close();
    });

    test('three failed pushes switch the mirror off with a telemetry row',
        () async {
      bloc.add(const SetLiveMirrorEvent(true));
      await settleBloc();
      repo.pushOk = false;

      for (var i = 0; i < 3; i++) {
        await bloc.liveMirrorTick();
      }
      await settleBloc();

      expect(bloc.state.liveMirrorEnabled, isFalse);
      expect(SettingsService.instance.liveMirrorEnabled, isFalse);
      expect(bloc.telemetry.single, contains('Live mirror stopped'));
    });
  });

  group('capture readiness', () {
    test('follows the native projection-state stream', () async {
      expect(bloc.state.captureReady, isFalse);

      bloc.projection.add(true);
      await settleBloc();
      expect(bloc.state.captureReady, isTrue);

      bloc.projection.add(false);
      await settleBloc();
      expect(bloc.state.captureReady, isFalse);
    });

    test('pollCaptureReady is the fallback when the stream is silent',
        () async {
      native.ready = true;
      await bloc.pollCaptureReady();
      await settleBloc();
      expect(bloc.state.captureReady, isTrue);

      native.ready = false;
      await bloc.pollCaptureReady();
      await settleBloc();
      expect(bloc.state.captureReady, isFalse);
    });

    test('the grant button obtains consent without touching the switch',
        () async {
      bloc.add(const GrantScreenCaptureEvent());
      await settleBloc();

      expect(native.prepareCalls, 1);
      expect(bloc.state.captureReady, isTrue);
      expect(bloc.state.liveMirrorEnabled, isFalse);
      expect(bloc.state.consentPending, isFalse);
    });

    test('a denied grant reports it and stays not-ready', () async {
      native.grant = false;

      bloc.add(const GrantScreenCaptureEvent());
      await settleBloc();

      expect(bloc.state.captureReady, isFalse);
      expect(bloc.state.errorMessage, isNotNull);
    });
  });

  group('MediaProjectionService.prepare', () {
    test('returns false on a native permission_timeout instead of throwing',
        () async {
      native.failWithCode = 'permission_timeout';
      expect(await MediaProjectionService.prepare(), isFalse);
    });

    test('still surfaces other native errors', () async {
      native.failWithCode = 'permission_request_active';
      await expectLater(
        MediaProjectionService.prepare(),
        throwsA(isA<PlatformException>()
            .having((e) => e.code, 'code', 'permission_request_active')),
      );
    });

    test('gives up on its own when the consent prompt never answers',
        () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(FakeProjectionNative.method, (call) async {
        if (call.method == 'prepareCapture') {
          // Never completes: the consent Activity never opened.
          return Future<Object?>.delayed(const Duration(minutes: 5));
        }
        return false;
      });

      final granted = await MediaProjectionService.prepare(
          timeout: const Duration(milliseconds: 80));
      expect(granted, isFalse);
    });
  });
}
