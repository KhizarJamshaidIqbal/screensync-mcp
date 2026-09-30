import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:screensync_flutter_project/blocs/live_hub_events_mixin.dart';
import 'package:screensync_flutter_project/blocs/screen_capture_event.dart';
import 'package:screensync_flutter_project/blocs/screen_capture_state.dart';
import 'package:screensync_flutter_project/repositories/screen_repository.dart';
import 'package:screensync_flutter_project/services/connection_metrics_service.dart';
import 'package:screensync_flutter_project/services/settings_service.dart';

import 'support/mirror_test_kit.dart';

/// "LIVE" used to mean "the SSE socket is open". It now means a frame really
/// arrived recently, judged on the phone's own clock.
class _EventsBloc extends Bloc<ScreenCaptureEvent, ScreenCaptureState>
    with LiveHubEventsMixin {
  _EventsBloc({ScreenCaptureState? initial})
      : super(initial ?? const ScreenCaptureState()) {
    // Handlers owned by the app bloc / other mixins that these events fan out to.
    on<LoadGalleryEvent>((e, emit) => galleryReloads++);
    on<ActivityRecordedEvent>((e, emit) {});
    on<SessionStatsChangedEvent>((e, emit) {});
    registerLiveEvents();
  }

  int galleryReloads = 0;
  int updateChecks = 0;
  // An empty hub URL keeps _syncLiveConnection from opening a real socket.
  final _repo = FakeScreenRepository(url: '');
  final _metrics = ConnectionMetricsService();

  @override
  ScreenRepository get hubRepo => _repo;
  @override
  SettingsService get hubSettings => SettingsService.instance;
  @override
  ConnectionMetricsService get metrics => _metrics;
  @override
  Future<void> handleAppUpdateEvent() async => updateChecks++;

  @override
  Future<void> close() {
    disposeLiveEvents();
    return super.close();
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await SettingsService.instance.init();
  });

  group('isFrameFresh', () {
    final now = DateTime(2026, 1, 1, 12);

    test('no frame yet is not fresh', () {
      expect(LiveHubEventsMixin.isFrameFresh(null, now: now), isFalse);
    });

    test('a frame inside the 60 s window is fresh', () {
      expect(
          LiveHubEventsMixin.isFrameFresh(
              now.subtract(const Duration(seconds: 59)),
              now: now),
          isTrue);
    });

    test('a frame at or past 60 s is stale', () {
      expect(
          LiveHubEventsMixin.isFrameFresh(
              now.subtract(const Duration(seconds: 60)),
              now: now),
          isFalse);
      expect(
          LiveHubEventsMixin.isFrameFresh(
              now.subtract(const Duration(minutes: 5)),
              now: now),
          isFalse);
    });
  });

  group('LIVE state', () {
    late _EventsBloc bloc;
    tearDown(() => bloc.close());

    test('an open SSE connection alone is not live', () async {
      bloc = _EventsBloc();
      bloc.add(const LiveConnectionEvent(true));
      await settleBloc();

      expect(bloc.state.liveConnected, isTrue);
      expect(bloc.state.framesFresh, isFalse);
    });

    test('a frame event makes it live, stamped with the phone clock',
        () async {
      bloc = _EventsBloc();
      final before = DateTime.now();

      bloc.add(const LiveHubEventEvent('frame'));
      await settleBloc();

      expect(bloc.state.framesFresh, isTrue);
      expect(bloc.state.lastFrameAt!.isBefore(before), isFalse);
      expect(bloc.galleryReloads, 1);
    });

    test('a frame this phone pushed itself also counts', () async {
      bloc = _EventsBloc();
      bloc.add(FrameSeenEvent(DateTime.now()));
      await settleBloc();
      expect(bloc.state.framesFresh, isTrue);
    });

    test('the tick flips a stale stream back to waiting without new events',
        () async {
      bloc = _EventsBloc(
        initial: ScreenCaptureState(
          liveConnected: true,
          framesFresh: true,
          lastFrameAt: DateTime.now().subtract(const Duration(seconds: 90)),
        ),
      );

      bloc.add(const FrameFreshnessTickEvent());
      await settleBloc();

      expect(bloc.state.framesFresh, isFalse);
      expect(bloc.state.liveConnected, isTrue, reason: 'SSE is still up');
    });

    test('the tick leaves a genuinely recent stream live', () async {
      bloc = _EventsBloc(
        initial: ScreenCaptureState(
          framesFresh: true,
          lastFrameAt: DateTime.now().subtract(const Duration(seconds: 5)),
        ),
      );
      bloc.add(const FrameFreshnessTickEvent());
      await settleBloc();
      expect(bloc.state.framesFresh, isTrue);
    });

    test('a late-arriving older frame never moves the timestamp back',
        () async {
      final recent = DateTime.now();
      bloc = _EventsBloc(
          initial: ScreenCaptureState(lastFrameAt: recent, framesFresh: true));

      bloc.add(FrameSeenEvent(recent.subtract(const Duration(minutes: 3))));
      await settleBloc();

      expect(bloc.state.lastFrameAt, recent);
      expect(bloc.state.framesFresh, isTrue);
    });

    test('agent_connect and app_update are still routed', () async {
      bloc = _EventsBloc();

      bloc.add(const LiveHubEventEvent('agent_connect', agentName: 'Claude Code'));
      bloc.add(const LiveHubEventEvent('app_update'));
      await settleBloc();

      expect(bloc.state.agentName, 'Claude Code');
      expect(bloc.updateChecks, 1);
    });
  });
}
