import 'dart:async';

import 'package:flutter_bloc/flutter_bloc.dart';

import '../repositories/screen_repository.dart';
import '../services/connection_metrics_service.dart';
import '../services/device_intent_service.dart';
import '../services/live_event_service.dart';
import '../services/session_recorder_service.dart';
import '../services/settings_service.dart';
import 'screen_capture_event.dart';
import 'screen_capture_state.dart';

/// The hub's live SSE push channel as seen by the bloc: connection lifecycle,
/// pushed events (frames, tool calls, inspections, patches, app updates) and
/// the "is a frame actually arriving" freshness that drives the LIVE badge.
mixin LiveHubEventsMixin on Bloc<ScreenCaptureEvent, ScreenCaptureState> {
  ScreenRepository get hubRepo;
  SettingsService get hubSettings;
  ConnectionMetricsService get metrics;

  /// Reacts to the hub's `app_update` broadcast (owned by the update flow).
  Future<void> handleAppUpdateEvent();

  /// A frame newer than this makes the stream "live". Matches the hub's own
  /// `connected` rule (a frame within the last 60 s), so the phone and the hub
  /// tell the same story.
  static const framesFreshFor = Duration(seconds: 60);

  StreamSubscription<LiveHubEvent>? _liveSub;
  StreamSubscription<bool>? _liveConnSub;
  StreamSubscription<ScreenCaptureState>? _liveStateSub;
  String? _liveKey;

  /// Whether a frame that arrived at [at] still counts as recent at [now].
  static bool isFrameFresh(DateTime? at, {DateTime? now}) =>
      at != null && (now ?? DateTime.now()).difference(at) < framesFreshFor;

  void registerLiveEvents() {
    on<LiveHubEventEvent>(_onLiveHubEvent);
    on<LiveConnectionEvent>(_onLiveConnection);
    on<FrameSeenEvent>(_onFrameSeen);
    on<FrameFreshnessTickEvent>(_onFreshnessTick);
    _liveSub = LiveEventService.instance.events.listen((event) =>
        add(LiveHubEventEvent(event.type,
            label: event.label, ok: event.ok, agentName: event.agentName)));
    _liveConnSub = LiveEventService.instance.connectionState
        .listen((connected) => add(LiveConnectionEvent(connected)));
    // Re-sync the SSE connection whenever hub URL / token state changes.
    _liveStateSub = stream.listen((_) => _syncLiveConnection());
    _syncLiveConnection();
  }

  void disposeLiveEvents() {
    _liveSub?.cancel();
    _liveConnSub?.cancel();
    _liveStateSub?.cancel();
    LiveEventService.instance.disconnect();
  }

  void _syncLiveConnection() {
    final url = hubRepo.hubUrl;
    final token = hubSettings.pairingToken;
    if (url.isEmpty) {
      if (_liveKey != null) {
        _liveKey = null;
        LiveEventService.instance.disconnect();
      }
      return;
    }
    final key = '$url|$token';
    if (_liveKey != key) {
      _liveKey = key;
      LiveEventService.instance.connect(url, token);
    }
  }

  void _onLiveConnection(
      LiveConnectionEvent event, Emitter<ScreenCaptureState> emit) {
    // F2: connection transitions land on the activity timeline so both
    // the feed and the UI toast layer can react.
    if (event.connected != state.liveConnected) {
      metrics.recordActivity(ActivityEvent(
        kind: event.connected ? 'connected' : 'disconnected',
        label: event.connected
            ? 'Live stream connected'
            : 'Live stream lost — reconnecting…',
        timestamp: DateTime.now(),
      ));
      add(const ActivityRecordedEvent());
    }
    emit(state.copyWith(liveConnected: event.connected));
  }

  void _onFrameSeen(FrameSeenEvent event, Emitter<ScreenCaptureState> emit) {
    final prev = state.lastFrameAt;
    final at = (prev != null && prev.isAfter(event.at)) ? prev : event.at;
    emit(state.copyWith(lastFrameAt: at, framesFresh: isFrameFresh(at)));
  }

  void _onFreshnessTick(
      FrameFreshnessTickEvent event, Emitter<ScreenCaptureState> emit) {
    final fresh = isFrameFresh(state.lastFrameAt);
    if (fresh != state.framesFresh) emit(state.copyWith(framesFresh: fresh));
  }

  Future<void> _onLiveHubEvent(
      LiveHubEventEvent event, Emitter<ScreenCaptureState> emit) async {
    // OTA: the hub broadcasts app_update the moment a newer APK is built, so a
    // paired phone learns about a release without polling for one.
    if (event.type == 'app_update') {
      unawaited(handleAppUpdateEvent());
      return;
    }
    // F3: agent_connect — surface the AI agent's identity (e.g. "Claude Code")
    // so the Connection Hero shows a real label instead of "Your AI".
    if (event.type == 'agent_connect') {
      if (event.agentName != null && event.agentName!.isNotEmpty) {
        emit(state.copyWith(agentName: event.agentName));
      }
      return;
    }
    // B3: tool calls land on the AI activity timeline with their real name.
    if (event.type == 'tool') {
      final activity = ActivityEvent(
        kind: 'tool',
        label: event.label ?? 'tool call',
        timestamp: DateTime.now(),
      );
      metrics.recordActivity(activity);
      SessionRecorderService.instance.observe(activity);
      metrics.recordAIResponse();
      add(const ActivityRecordedEvent());
      add(const SessionStatsChangedEvent());
      return;
    }
    // B1: a frame landed on the hub — refresh the live strip / gallery. Local
    // receipt time, not the hub's clock: the two machines may disagree.
    if (event.type == 'frame') {
      final activity = ActivityEvent(
        kind: 'frame',
        label: 'Frame delivered',
        timestamp: DateTime.now(),
      );
      metrics.recordActivity(activity);
      SessionRecorderService.instance.observe(activity);
      add(const ActivityRecordedEvent());
      add(FrameSeenEvent(DateTime.now()));
      add(LoadGalleryEvent());
      return;
    }
    if (event.type != 'inspection' && event.type != 'patch') return;
    add(FetchDiagnosisEvent());
    DeviceIntentService.postNotification(
      'ScreenSync',
      event.type == 'patch'
          ? 'Claude published a patch — tap to view'
          : 'Claude published a new diagnosis — tap to view',
    ).ignore();
    // Live-bridge: record the AI event in the activity feed.
    metrics.recordActivity(ActivityEvent(
      kind: event.type,
      label: event.type == 'patch' ? 'Patch published' : 'Inspection ready',
      timestamp: DateTime.now(),
    ));
    metrics.recordAIResponse();
    add(const ActivityRecordedEvent());
    add(const SessionStatsChangedEvent());
  }
}
