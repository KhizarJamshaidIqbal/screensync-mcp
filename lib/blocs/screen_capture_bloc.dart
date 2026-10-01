import 'dart:async';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_overlay_window/flutter_overlay_window.dart';

import '../models/capture_quality.dart';
import '../models/captured_frame.dart';
import '../models/telemetry_event.dart';
import '../repositories/capture_cache_repository.dart';
import '../repositories/screen_repository.dart';
import '../repositories/sync_mode.dart';
import '../services/app_update_service.dart';
import '../services/capture_pipeline_service.dart';
import '../services/capture_trigger_bridge.dart';
import '../services/connection_metrics_service.dart';
import '../services/device_intent_service.dart';
import '../services/settings_service.dart';
import '../services/shake_trigger_service.dart';
import 'capture_sync_mixin.dart';
import 'hub_maintenance_mixin.dart';
import 'live_hub_events_mixin.dart';
import 'live_mirror_mixin.dart';
import 'screen_capture_event.dart';
import 'screen_capture_state.dart';

export 'screen_capture_event.dart';
export 'screen_capture_state.dart';

class ScreenCaptureBloc extends Bloc<ScreenCaptureEvent, ScreenCaptureState>
    with
        HubMaintenanceMixin,
        CaptureSyncMixin,
        LiveHubEventsMixin,
        LiveMirrorMixin {
  final ScreenRepository _screenRepository;
  final CaptureCacheRepository _cacheRepo;
  final SettingsService _settings;
  final ConnectionMetricsService _metrics;

  @override
  ScreenRepository get hubRepo => _screenRepository;
  @override
  SettingsService get hubSettings => _settings;
  @override
  CaptureCacheRepository get cacheRepo => _cacheRepo;
  @override
  void recordDiscoveryTelemetry({
    required String kind,
    required String label,
    required int durationMs,
    required bool ok,
  }) =>
      recordTelemetry(kind: kind, label: label, durationMs: durationMs, ok: ok);

  /// Exposed for UI widgets that need direct repo access (e.g. device status).
  ScreenRepository get screenRepository => _screenRepository;

  /// Exposed for widgets that need to record/inspect metrics directly
  /// (e.g. test widgets, manual debug). The BLoC owns the canonical service
  /// instance; widgets must not hold their own.
  @override
  ConnectionMetricsService get metrics => _metrics;

  StreamSubscription<dynamic>? _overlaySub;
  StreamSubscription<Map<String, Object?>>? _bridgeSub;
  StreamSubscription<void>? _shakeSub;
  DateTime _lastBubbleTrigger = DateTime.fromMillisecondsSinceEpoch(0);
  Timer? _latencySampler;

  ScreenCaptureBloc({
    ScreenRepository? screenRepository,
    CaptureCacheRepository? cacheRepository,
    ConnectionMetricsService? metrics,
  })  : _screenRepository = screenRepository ?? ScreenRepository(),
        _cacheRepo = cacheRepository ?? CaptureCacheRepository(),
        _settings = SettingsService.instance,
        _metrics = metrics ?? ConnectionMetricsService(),
        super(ScreenCaptureState(
            liveMirrorEnabled: SettingsService.instance.liveMirrorEnabled)) {
    _wireResolvers();
    _registerHandlers();
    registerHubMaintenance();
    registerCaptureSync();
    registerLiveEvents();
    registerLiveMirror();
    _listenToTriggers();
    _seedFromSettings();
    _startLatencySampler();
  }

  void _wireResolvers() {
    _screenRepository.onTelemetry = recordTelemetry;
    _screenRepository.hubUrlResolver = () => _settings.hubUrlOverride;
    _screenRepository.tokenResolver = () => _settings.pairingToken;
  }

  @override
  void recordTelemetry({
    required String kind,
    required String label,
    required int durationMs,
    required bool ok,
  }) {
    _settings.appendTelemetry(TelemetryEvent(
      kind: kind,
      label: label,
      durationMs: durationMs,
      ok: ok,
      timestamp: DateTime.now(),
    ));
    if (!isClosed) add(const ClearTelemetryEvent.refresh());
  }

  void _registerHandlers() {
    on<StartOverlayServiceEvent>(_onStartOverlay);
    on<StopOverlayServiceEvent>(_onStopOverlay);
    on<TriggerScreenCaptureEvent>(_onTriggerCapture);
    on<RegionSelectRequestedEvent>(_onRegionSelectRequested);
    on<CommitRegionCropEvent>(_onCommitRegionCrop);
    on<ClearRegionRequestEvent>(_onClearRegionRequest);
    on<ToggleSyncModeEvent>(_onToggleSyncMode);
    on<SetQualityEvent>(_onSetQuality);
    on<FetchDiagnosisEvent>(_onFetchDiagnosis);
    on<ClearTelemetryEvent>(_onClearTelemetry);
    on<OverlayBubbleToggledExternally>(_onOverlayToggledExternally);
    // Live-bridge (ConnectionHero 2.0) handlers.
    on<LatencySampledEvent>(_onLatencySampled);
    on<QuickCaptureRequestedEvent>(_onQuickCapture);
    on<QuickSyncRequestedEvent>(_onQuickSync);
    on<QuickPingRequestedEvent>(_onQuickPing);
    on<RetryUnsyncedRequestedEvent>(_onRetryUnsynced);
    on<ActivityRecordedEvent>((event, emit) =>
        emit(state.copyWith(activityFeed: _metrics.activityFeed)));
    on<SessionStatsChangedEvent>((event, emit) =>
        emit(state.copyWith(sessionStats: _metrics.sessionStats)));
    on<DeviceNameResolvedEvent>(_onDeviceNameResolved);
  }

  /// Overlay-engine taps arrive via both the plugin message bus and the
  /// filesystem bridge (the bridge keeps working while the main activity
  /// is backgrounded, where the plugin bus may be suspended).
  void _listenToTriggers() {
    _overlaySub = FlutterOverlayWindow.overlayListener.listen((data) {
      if (data == 'TRIGGER_CAPTURE') _handleBubbleTrigger('overlay_message');
    });
    _bridgeSub = CaptureTriggerBridge.watch().listen((event) {
      final type = event['type'] as String?;
      if (type == 'CAPTURE') {
        _handleBubbleTrigger(event['source'] as String? ?? 'bridge',
            requestId: event['nonce']);
      } else if (type == 'REGION_CAPTURE') {
        _handleRegionTrigger(event['source'] as String? ?? 'region_selector');
      } else if (type == 'CROP_CAPTURE') {
        // Legacy overlay-window crop path (kept for backward compatibility).
        final rect = event['rect'] as Map<String, dynamic>?;
        if (rect != null) {
          _handleBubbleTrigger('region_selector',
              crop: NormRect(
                (rect['nx'] as num?)?.toDouble() ?? 0,
                (rect['ny'] as num?)?.toDouble() ?? 0,
                (rect['nw'] as num?)?.toDouble() ?? 0,
                (rect['nh'] as num?)?.toDouble() ?? 0,
              ));
        }
      } else if (type == 'NOTIFICATION_SNAP') {
        // The "MCP" action keeps its old meaning (push what is pending); the
        // "Snap" action is a capture request like a bubble tap. Each tap
        // carries a unique payload, so the bridge's exact-payload dedupe
        // cannot swallow a second one.
        if (event['source'] == 'MCP') {
          add(SyncPendingEvent());
        } else {
          _handleBubbleTrigger('notification_snap');
        }
      }
    });
    _syncShakeListener();
    add(LoadGalleryEvent());
    add(PingHubEvent());
  }

  void _seedFromSettings() {
    add(ToggleSyncModeEvent(
        SyncMode.values[_settings.syncModeIndex.clamp(0, SyncMode.values.length - 1)]));
    add(SetQualityEvent(_settings.defaultQuality));
    _fetchDeviceName();
  }

  /// F2: Resolve the Android device model (e.g. "Pixel 7") via device_info_plus
  /// so the Connection Hero shows a real label instead of "This phone".
  Future<void> _fetchDeviceName() async {
    try {
      final info = await DeviceInfoPlugin().androidInfo;
      if (info.model.isNotEmpty) {
        add(DeviceNameResolvedEvent(info.model));
      }
    } catch (_) {
      // Desktop / emulator without Android → fall back to "This phone".
    }
  }

  void _syncShakeListener() {
    _shakeSub?.cancel();
    if (!_settings.shakeEnabled) {
      _shakeSub = null;
      return;
    }
    _shakeSub = shakeGestures(threshold: _settings.shakeThreshold)
        .listen((_) => _handleBubbleTrigger('shake'));
  }

  /// Re-arms the shake listener after settings change (called from UI).
  void retuneShakeListener() => _syncShakeListener();

  // ── Live push (SSE) lives in LiveHubEventsMixin; this is its update hook ──

  /// Reacts to the hub's app_update broadcast: re-check the manifest, tell the
  /// user, and leave the final install tap to them.
  @override
  Future<void> handleAppUpdateEvent() async {
    final info = await AppUpdateService.instance.check(
      hubUrl: _screenRepository.hubUrl,
      token: _settings.pairingToken,
    );
    if (info == null || !info.updateAvailable) return;
    // "Later" on the update dialog silences this build for 24 h.
    if (await AppUpdateService.instance.isDismissed(info.versionCode)) return;
    _metrics.recordActivity(ActivityEvent(
      kind: 'update',
      label: 'App update available: ${info.versionName}',
      timestamp: DateTime.now(),
    ));
    add(const ActivityRecordedEvent());
    unawaited(DeviceIntentService.postNotification(
      'ScreenSync ${info.versionName} available',
      'Open ScreenSync > MCP tab to install the update.',
    ));
  }

  void _handleBubbleTrigger(String source,
      {NormRect? crop, Object? requestId}) {
    final now = DateTime.now();
    if (now.difference(_lastBubbleTrigger) < const Duration(seconds: 1)) {
      // Tell the bubble its tap was dropped instead of leaving it waiting.
      _reportCaptureResult(requestId, ok: false, error: 'busy');
      return;
    }
    _lastBubbleTrigger = now;
    add(TriggerScreenCaptureEvent(
        triggerSource: source, crop: crop, requestId: requestId));
  }

  /// Hands the outcome of a bubble tap back to the overlay engine (a separate
  /// isolate) so the bubble shows what really happened.
  void _reportCaptureResult(Object? requestId,
      {required bool ok, String? path, String? error}) {
    if (requestId == null) return;
    CaptureTriggerBridge.writeCaptureResult(requestId,
            ok: ok, path: path, error: error)
        .ignore();
  }

  void _handleRegionTrigger(String source) {
    final now = DateTime.now();
    if (now.difference(_lastBubbleTrigger) < const Duration(seconds: 1)) return;
    _lastBubbleTrigger = now;
    add(RegionSelectRequestedEvent(triggerSource: source));
  }

  // ── HANDLERS ──

  Future<void> _onStartOverlay(
      StartOverlayServiceEvent event, Emitter<ScreenCaptureState> emit) async {
    emit(state.copyWith(status: CaptureStatus.capturing));
    try {
      final started = await _screenRepository.initializeOverlayAndProjection();
      emit(
        state.copyWith(
          isOverlayRunning: started,
          captureReady: started,
          status: started ? CaptureStatus.idle : CaptureStatus.failure,
          errorMessage: started
              ? null
              : 'Screen capture or display-over-apps permission was not granted.',
        ),
      );
    } catch (error) {
      emit(
        state.copyWith(
          isOverlayRunning: false,
          status: CaptureStatus.failure,
          errorMessage: 'Could not start floating bubble: $error',
        ),
      );
    }
  }

  Future<void> _onStopOverlay(
      StopOverlayServiceEvent event, Emitter<ScreenCaptureState> emit) async {
    await _screenRepository.stopOverlay();
    emit(state.copyWith(isOverlayRunning: false, captureReady: false));
  }

  void _onOverlayToggledExternally(
      OverlayBubbleToggledExternally event, Emitter<ScreenCaptureState> emit) {
    emit(state.copyWith(isOverlayRunning: event.running));
  }

  Future<void> _onTriggerCapture(
      TriggerScreenCaptureEvent event, Emitter<ScreenCaptureState> emit) async {
    final quality = event.quality ?? state.quality;
    emit(state.copyWith(status: CaptureStatus.capturing));
    try {
      final frame = await _screenRepository.captureCurrentDisplay(
        quality: quality,
        crop: event.crop,
      );
      emit(state.copyWith(status: CaptureStatus.uploading, latestFrame: frame));
      await persistAndSync(frame, emit);
      _reportCaptureResult(event.requestId,
          ok: true, path: state.latestFramePath);
    } catch (e) {
      emit(state.copyWith(
          status: CaptureStatus.failure, errorMessage: e.toString()));
      _reportCaptureResult(event.requestId, ok: false, error: e.toString());
    }
  }

  /// Long-press: grab the FULL display now (uncropped, native PNG so the crop
  /// editor gets max resolution) and hand the bytes to the UI to open the
  /// region editor. We do NOT persist/sync yet — only the cropped result is.
  Future<void> _onRegionSelectRequested(RegionSelectRequestedEvent event,
      Emitter<ScreenCaptureState> emit) async {
    emit(state.copyWith(status: CaptureStatus.capturing));
    try {
      // Bring the app to the foreground so the full-screen editor is visible
      // (the long-press happened while another app was in front).
      DeviceIntentService.bringAppToFront().ignore();
      final frame = await _screenRepository.captureCurrentDisplay(
        quality: CaptureQuality.inspection,
      );
      emit(state.copyWith(
        status: CaptureStatus.idle,
        regionBytes: frame.imageBytes,
        regionRequestId: state.regionRequestId + 1,
      ));
    } catch (e) {
      emit(state.copyWith(
          status: CaptureStatus.failure,
          errorMessage: 'Region capture failed: $e'));
    }
  }

  /// User confirmed a crop rect: crop the pending full frame and sync it.
  Future<void> _onCommitRegionCrop(
      CommitRegionCropEvent event, Emitter<ScreenCaptureState> emit) async {
    final raw = state.regionBytes;
    if (raw == null) return;
    emit(state.copyWith(status: CaptureStatus.uploading, regionBytes: null));
    try {
      final quality = state.quality;
      final cropped = await CapturePipeline.process(
        raw,
        quality,
        crop: event.rect,
      );
      final frame = CapturedFrame(imageBytes: cropped, mimeType: quality.mime);
      emit(state.copyWith(latestFrame: frame));
      await persistAndSync(frame, emit);
    } catch (e) {
      emit(state.copyWith(
          status: CaptureStatus.failure,
          errorMessage: 'Region crop failed: $e'));
    }
  }

  void _onClearRegionRequest(
      ClearRegionRequestEvent event, Emitter<ScreenCaptureState> emit) {
    emit(state.copyWith(regionBytes: null));
  }

  void _onToggleSyncMode(
      ToggleSyncModeEvent event, Emitter<ScreenCaptureState> emit) {
    _settings.syncModeIndex = event.mode.index;
    emit(state.copyWith(syncMode: event.mode));
  }

  void _onSetQuality(SetQualityEvent event, Emitter<ScreenCaptureState> emit) {
    _settings.defaultQuality = event.quality;
    emit(state.copyWith(quality: event.quality));
  }

  Future<void> _onFetchDiagnosis(
      FetchDiagnosisEvent event, Emitter<ScreenCaptureState> emit) async {
    try {
      final regions = await _screenRepository.fetchBugRegions();
      Map<String, dynamic>? patch;
      try {
        patch = await _screenRepository.fetchLatestPatch();
      } catch (_) {/* patch endpoint optional */}
      emit(state.copyWith(
        bugRegions: regions,
        patch: patch,
        errorMessage: null,
        gallery: await _cacheRepo.recentFrames(),
      ));
    } catch (e) {
      emit(state.copyWith(errorMessage: 'Diagnosis fetch failed: $e'));
    }
  }

  void _onClearTelemetry(
      ClearTelemetryEvent event, Emitter<ScreenCaptureState> emit) {
    if (event.refreshOnly) {
      emit(state.copyWith(telemetry: _settings.telemetryLog));
      return;
    }
    _settings.clearTelemetry();
    emit(state.copyWith(telemetry: const []));
  }

  @override
  Future<void> close() {
    _overlaySub?.cancel();
    _bridgeSub?.cancel();
    _shakeSub?.cancel();
    _latencySampler?.cancel();
    disposeLiveMirror();
    disposeLiveEvents();
    disposeHubMaintenance();
    return super.close();
  }

  // ── Live-bridge (ConnectionHero 2.0) ──

  /// 5-second ping cadence feeds the sparkline + health classification
  /// even when the user is idle. Cheaper than the 20s `_maintainHub` tick
  /// because it doesn't try mDNS or auto-discovery — just a single HTTP
  /// round-trip against the already-resolved hub URL.
  void _startLatencySampler() {
    _latencySampler?.cancel();
    _latencySampler =
        Timer.periodic(const Duration(seconds: 5), (_) => _sampleLatency());
  }

  Future<void> _sampleLatency() async {
    // Housekeeping that must run even while no hub is set: the capture-session
    // poll (fallback for the native state stream) and the LIVE-badge freshness.
    unawaited(pollCaptureReady());
    addIfOpen(const FrameFreshnessTickEvent());
    if (state.hubUrl.isEmpty) return;
    try {
      final res = await _screenRepository.pingHubTimed(
          timeout: const Duration(seconds: 2));
      if (res.ok && res.ms > 0) {
        _metrics.recordLatency(res.ms);
        addIfOpen(LatencySampledEvent(res.ms));
      }
    } catch (_) {/* periodic sampler must never crash the bloc */}
  }

  Future<void> _onLatencySampled(
      LatencySampledEvent event, Emitter<ScreenCaptureState> emit) async {
    emit(state.copyWith(latencyHistory: _metrics.latencyHistory));
  }

  Future<void> _onQuickCapture(
      QuickCaptureRequestedEvent event, Emitter<ScreenCaptureState> emit) async {
    HapticFeedback.lightImpact();
    add(const TriggerScreenCaptureEvent(triggerSource: 'hero_quick_capture'));
  }

  Future<void> _onQuickSync(
      QuickSyncRequestedEvent event, Emitter<ScreenCaptureState> emit) async {
    HapticFeedback.lightImpact();
    add(SyncPendingEvent());
  }

  Future<void> _onQuickPing(
      QuickPingRequestedEvent event, Emitter<ScreenCaptureState> emit) async {
    HapticFeedback.selectionClick();
    add(PingHubEvent());
    // Reflect the new sample in the sparkline too.
    Future<void>.delayed(const Duration(milliseconds: 100), _sampleLatency);
  }

  Future<void> _onRetryUnsynced(
      RetryUnsyncedRequestedEvent event,
      Emitter<ScreenCaptureState> emit) async {
    HapticFeedback.lightImpact();
    add(SyncPendingEvent());
  }

  void _onDeviceNameResolved(
      DeviceNameResolvedEvent event, Emitter<ScreenCaptureState> emit) {
    emit(state.copyWith(deviceName: event.name));
  }
}
