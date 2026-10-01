import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../models/capture_quality.dart';
import '../repositories/screen_repository.dart';
import '../services/connection_metrics_service.dart';
import '../services/media_projection_service.dart';
import '../services/settings_service.dart';
import 'screen_capture_event.dart';
import 'screen_capture_state.dart';

/// Internal: the projection session went live or ended (native stream / poll).
class CaptureReadyChangedEvent extends ScreenCaptureEvent {
  final bool ready;
  const CaptureReadyChangedEvent(this.ready);
  @override
  List<Object?> get props => [ready];
}

/// Internal: the mirror timer decided it is (or is no longer) stuck waiting for
/// a screen-capture session. Published as an event because `emit` is only valid
/// inside a handler.
class MirrorWaitingChangedEvent extends ScreenCaptureEvent {
  final bool waiting;
  const MirrorWaitingChangedEvent(this.waiting);
  @override
  List<Object?> get props => [waiting];
}

/// Opt-in live mirror (phone screen -> hub) and the capture-session readiness
/// it depends on.
///
/// The device owner switches this on from Settings. It is deliberately NOT
/// exposed as an MCP tool, so no agent can start watching the screen by itself.
/// While on, one low-latency 480p frame is captured and pushed on an interval;
/// the hub's SSE "frame" event then carries it to every listener.
///
/// Consent rules (Android needs a fresh MediaProjection grant per app process):
///  * turning the switch on asks for consent right away, from the foreground;
///  * the background timer NEVER asks. When there is no session it counts the
///    skip, and after [mirrorWaitTicks] in a row raises `mirrorWaiting` so the
///    UI can offer a "Grant screen capture" button.
mixin LiveMirrorMixin on Bloc<ScreenCaptureEvent, ScreenCaptureState> {
  ScreenRepository get hubRepo;
  SettingsService get hubSettings;
  ConnectionMetricsService get metrics;
  void recordTelemetry({
    required String kind,
    required String label,
    required int durationMs,
    required bool ok,
  });

  /// Consecutive not-ready ticks before the mirror reports it is waiting.
  static const mirrorWaitTicks = 5;

  /// Failed captures/pushes in a row before the mirror switches itself off.
  static const mirrorMaxFailures = 3;

  /// Live projection state; overridable so tests need no native channel.
  @visibleForTesting
  Stream<bool> get projectionStateStream => MediaProjectionService.stateStream;

  Timer? _mirrorTimer;
  bool _mirrorBusy = false;
  int _mirrorFailures = 0;
  int _mirrorNotReadyTicks = 0;
  bool _consentInFlight = false;

  /// True while the capture session exists only because THIS mixin's consent
  /// prompt started it (it was not live before and the bubble was not running).
  /// Such a session has no other owner and no Stop button in the UI, so
  /// switching the mirror off must end it; otherwise an all-app screen capture
  /// and its notification would stay live with nothing to show for it.
  bool _ownsProjection = false;
  StreamSubscription<bool>? _projectionSub;

  void registerLiveMirror() {
    on<SetLiveMirrorEvent>(_onSetLiveMirror);
    on<GrantScreenCaptureEvent>(_onGrantScreenCapture);
    on<CaptureReadyChangedEvent>(
        (event, emit) => emit(state.copyWith(captureReady: event.ready)));
    on<MirrorWaitingChangedEvent>(
        (event, emit) => emit(state.copyWith(mirrorWaiting: event.waiting)));
    _projectionSub = projectionStateStream.listen(
      (ready) {
        // Someone else ended the session (Android, the bubble's Stop): there is
        // nothing left for the mirror to release.
        if (!ready) _ownsProjection = false;
        addIfOpen(CaptureReadyChangedEvent(ready));
      },
      onError: (Object _) {/* polling in pollCaptureReady covers this */},
    );
    unawaited(pollCaptureReady());
    if (hubSettings.liveMirrorEnabled) startLiveMirror();
  }

  void disposeLiveMirror() {
    stopLiveMirror();
    _projectionSub?.cancel();
    _projectionSub = null;
  }

  /// `add` that survives a close() racing an in-flight async callback.
  void addIfOpen(ScreenCaptureEvent event) {
    if (!isClosed) add(event);
  }

  /// Polls the native session state (the fallback beside the event stream, run
  /// from the 5 s sampler). A failed poll keeps the last known value.
  Future<void> pollCaptureReady() async {
    final bool ready;
    try {
      ready = await MediaProjectionService.isReady();
    } catch (_) {
      return;
    }
    if (ready != state.captureReady) addIfOpen(CaptureReadyChangedEvent(ready));
  }

  void startLiveMirror() {
    _mirrorTimer?.cancel();
    final ms = hubSettings.liveMirrorIntervalMs.clamp(1500, 60000);
    _mirrorFailures = 0;
    _mirrorNotReadyTicks = 0;
    _mirrorTimer =
        Timer.periodic(Duration(milliseconds: ms), (_) => liveMirrorTick());
  }

  void stopLiveMirror() {
    _mirrorTimer?.cancel();
    _mirrorTimer = null;
  }

  Future<void> _onSetLiveMirror(
      SetLiveMirrorEvent event, Emitter<ScreenCaptureState> emit) async {
    if (!event.enabled) {
      stopLiveMirror();
      hubSettings.liveMirrorEnabled = false;
      emit(state.copyWith(
        liveMirrorEnabled: false,
        mirrorWaiting: false,
        consentPending: false,
        errorMessage: null,
      ));
      await _releaseOwnedProjection();
      return;
    }
    if (_consentInFlight) return; // a prompt is already open; ignore re-taps
    _consentInFlight = true;
    emit(state.copyWith(consentPending: true, errorMessage: null));
    final outcome = await _requestConsent(forMirror: true);
    _consentInFlight = false;
    if (!outcome.granted) {
      // Refused, timed out or errored: the switch must not stay on with
      // nothing behind it.
      stopLiveMirror();
      hubSettings.liveMirrorEnabled = false;
      emit(state.copyWith(
        liveMirrorEnabled: false,
        mirrorWaiting: false,
        consentPending: false,
        errorMessage: outcome.message,
      ));
      return;
    }
    hubSettings.liveMirrorEnabled = true;
    startLiveMirror();
    emit(state.copyWith(
      liveMirrorEnabled: true,
      captureReady: true,
      mirrorWaiting: false,
      consentPending: false,
      // Only claimed because consent really was granted just now.
      errorMessage: 'Live mirror on - a frame is pushed every '
          '${(hubSettings.liveMirrorIntervalMs / 1000).toStringAsFixed(1)}s.',
    ));
  }

  Future<void> _onGrantScreenCapture(
      GrantScreenCaptureEvent event, Emitter<ScreenCaptureState> emit) async {
    if (_consentInFlight) return;
    _consentInFlight = true;
    emit(state.copyWith(consentPending: true, errorMessage: null));
    // The grant button also serves the bubble; the session is the mirror's to
    // release only while the mirror is the thing waiting for it.
    final outcome = await _requestConsent(forMirror: state.liveMirrorEnabled);
    _consentInFlight = false;
    if (outcome.granted) {
      // Let the timer's stall counter start over; the flag itself clears on
      // the first successful push.
      _mirrorNotReadyTicks = 0;
      emit(state.copyWith(captureReady: true, consentPending: false));
    } else {
      emit(state.copyWith(
        consentPending: false,
        errorMessage: outcome.message,
      ));
    }
  }

  /// Ends the capture session this mixin started for the mirror, unless the
  /// bubble has since come up (then the bubble owns it). Best-effort.
  Future<void> _releaseOwnedProjection() async {
    if (!_ownsProjection) return;
    _ownsProjection = false;
    if (state.isOverlayRunning) return;
    try {
      await MediaProjectionService.stop();
      addIfOpen(const CaptureReadyChangedEvent(false));
    } catch (_) {/* the session may already be gone */}
  }

  /// Asks for screen-capture consent (foreground callers only). Never throws.
  /// [forMirror] marks a session this call starts as the mirror's to release.
  Future<({bool granted, String? message})> _requestConsent(
      {required bool forMirror}) async {
    try {
      if (await MediaProjectionService.isReady()) {
        return (granted: true, message: null);
      }
    } catch (_) {/* prepare() below reports the real problem */}
    try {
      final ok = await MediaProjectionService.prepare();
      if (ok && forMirror && !state.isOverlayRunning) _ownsProjection = true;
      return ok
          ? (granted: true, message: null)
          : (
              granted: false,
              message: 'Screen capture was not allowed (denied, or the '
                  'permission prompt timed out), so Live mirror stays off.',
            );
    } on PlatformException catch (e) {
      return (
        granted: false,
        message: switch (e.code) {
          'permission_request_active' =>
            'A screen-capture permission prompt is already open. Finish it, '
                'then try again.',
          'permission_timeout' =>
            'The screen-capture prompt timed out. Try again and accept it.',
          _ => 'Could not start screen capture: ${e.message ?? e.code}',
        },
      );
    } catch (e) {
      return (granted: false, message: 'Could not start screen capture: $e');
    }
  }

  /// One mirror tick. Public only so tests can drive it without a real timer.
  @visibleForTesting
  Future<void> liveMirrorTick() async {
    if (_mirrorBusy) return; // never overlap captures
    if (state.hubOnline != true || state.hubUrl.isEmpty) return;
    // The projection session belongs to the bubble / the consent flow. If it
    // is not up, count the skip and leave it be: calling prepare() from a
    // background timer could raise a consent dialog off an activity.
    var ready = false;
    try {
      ready = await MediaProjectionService.isReady();
    } catch (_) {/* treated as not ready */}
    if (!ready) {
      _noteMirrorNotReady();
      return;
    }
    _mirrorNotReadyTicks = 0;
    _mirrorBusy = true;
    try {
      final frame = await hubRepo.captureCurrentDisplay(
        quality: CaptureQuality.stream,
        allowPrompt: false,
      );
      // Deliberately not persisted to the local gallery: the hub keeps its own
      // recent frames, and a row every few seconds would bury real captures.
      final ok = await hubRepo.pushToLocalMcpServer(frame);
      if (ok) {
        _mirrorFailures = 0;
        metrics.incrementHubPush();
        _mirrorPushed();
      } else {
        _mirrorFailures++;
      }
    } catch (_) {
      _mirrorFailures++;
    } finally {
      _mirrorBusy = false;
    }
    // Self-stop instead of hammering: repeated failures mean capture or upload
    // is not working, and the user is told rather than left guessing.
    if (_mirrorFailures >= mirrorMaxFailures) {
      stopLiveMirror();
      hubSettings.liveMirrorEnabled = false;
      recordTelemetry(
        kind: 'upload',
        label: 'Live mirror stopped - capture/upload failing',
        durationMs: 0,
        ok: false,
      );
      addIfOpen(const SetLiveMirrorEvent(false));
    }
  }

  void _noteMirrorNotReady() {
    _mirrorNotReadyTicks++;
    // Exactly once per stall: the counter resets as soon as capture is ready.
    if (_mirrorNotReadyTicks == mirrorWaitTicks) {
      recordTelemetry(
        kind: 'upload',
        label: 'Live mirror waiting - screen capture is not active',
        durationMs: 0,
        ok: false,
      );
      addIfOpen(const MirrorWaitingChangedEvent(true));
    }
  }

  void _mirrorPushed() {
    if (state.mirrorWaiting) addIfOpen(const MirrorWaitingChangedEvent(false));
    if (!state.captureReady) addIfOpen(const CaptureReadyChangedEvent(true));
    addIfOpen(FrameSeenEvent(DateTime.now()));
  }
}
