import 'dart:async';
import 'dart:io' as io;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_overlay_window/flutter_overlay_window.dart';
import 'package:path_provider/path_provider.dart';

import '../models/capture_quality.dart';
import '../models/captured_frame.dart';
import '../models/telemetry_event.dart';
import '../repositories/capture_cache_repository.dart';
import '../repositories/screen_repository.dart';
import '../repositories/sync_mode.dart';
import '../services/capture_pipeline_service.dart';
import '../services/capture_trigger_bridge.dart';
import '../services/connection_metrics_service.dart';
import '../services/device_intent_service.dart';
import '../services/live_event_service.dart';
import '../services/settings_service.dart';
import '../services/shake_trigger_service.dart';
import 'hub_maintenance_mixin.dart';
import 'screen_capture_event.dart';
import 'screen_capture_state.dart';

export 'screen_capture_event.dart';
export 'screen_capture_state.dart';

class ScreenCaptureBloc extends Bloc<ScreenCaptureEvent, ScreenCaptureState>
    with HubMaintenanceMixin {
  final ScreenRepository _screenRepository;
  final CaptureCacheRepository _cacheRepo;
  final SettingsService _settings;
  final ConnectionMetricsService _metrics;

  @override
  ScreenRepository get hubRepo => _screenRepository;
  @override
  SettingsService get hubSettings => _settings;
  @override
  void recordDiscoveryTelemetry({
    required String kind,
    required String label,
    required int durationMs,
    required bool ok,
  }) =>
      _recordTelemetry(
          kind: kind, label: label, durationMs: durationMs, ok: ok);

  /// Exposed for UI widgets that need direct repo access (e.g. device status).
  ScreenRepository get screenRepository => _screenRepository;

  /// Exposed for widgets that need to record/inspect metrics directly
  /// (e.g. test widgets, manual debug). The BLoC owns the canonical service
  /// instance; widgets must not hold their own.
  ConnectionMetricsService get metrics => _metrics;

  StreamSubscription<dynamic>? _overlaySub;
  StreamSubscription<Map<String, Object?>>? _bridgeSub;
  StreamSubscription<void>? _shakeSub;
  StreamSubscription<LiveHubEvent>? _liveSub;
  StreamSubscription<bool>? _liveConnSub;
  StreamSubscription<ScreenCaptureState>? _stateSub;
  String? _liveKey;
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
        super(const ScreenCaptureState()) {
    _wireResolvers();
    _registerHandlers();
    registerHubMaintenance();
    _listenToTriggers();
    _seedFromSettings();
    _wireLiveEvents();
    _startLatencySampler();
  }

  void _wireResolvers() {
    _screenRepository.onTelemetry = _recordTelemetry;
    _screenRepository.hubUrlResolver = () => _settings.hubUrlOverride;
    _screenRepository.tokenResolver = () => _settings.pairingToken;
  }

  void _recordTelemetry({
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
    add(const ClearTelemetryEvent.refresh());
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
    on<LoadGalleryEvent>(_onLoadGallery);
    on<SyncPendingEvent>(_onSyncPending);
    on<DeleteFrameEvent>(_onDeleteFrame);
    on<FetchDiagnosisEvent>(_onFetchDiagnosis);
    on<ClearTelemetryEvent>(_onClearTelemetry);
    on<OverlayBubbleToggledExternally>(_onOverlayToggledExternally);
    on<LiveHubEventEvent>(_onLiveHubEvent);
    on<LiveConnectionEvent>((event, emit) =>
        emit(state.copyWith(liveConnected: event.connected)));
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
        _handleBubbleTrigger(event['source'] as String? ?? 'bridge');
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
        add(SyncPendingEvent());
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

  // ── Live push (SSE) ──

  void _wireLiveEvents() {
    _liveSub = LiveEventService.instance.events
        .listen((event) => add(LiveHubEventEvent(event.type)));
    _liveConnSub = LiveEventService.instance.connectionState
        .listen((connected) => add(LiveConnectionEvent(connected)));
    // Re-sync the SSE connection whenever hub URL / token state changes.
    _stateSub = stream.listen((_) => _syncLiveConnection());
    _syncLiveConnection();
  }

  void _syncLiveConnection() {
    final url = _screenRepository.hubUrl;
    final token = _settings.pairingToken;
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

  Future<void> _onLiveHubEvent(
      LiveHubEventEvent event, Emitter<ScreenCaptureState> emit) async {
    if (event.type != 'inspection' && event.type != 'patch') return;
    add(FetchDiagnosisEvent());
    DeviceIntentService.postNotification(
      'ScreenSync',
      event.type == 'patch'
          ? 'Claude published a patch — tap to view'
          : 'Claude published a new diagnosis — tap to view',
    ).ignore();
    // Live-bridge: record the AI event in the activity feed.
    _metrics.recordActivity(ActivityEvent(
      kind: event.type,
      label: event.type == 'patch' ? 'Patch published' : 'Inspection ready',
      timestamp: DateTime.now(),
    ));
    _metrics.recordAIResponse();
    add(const ActivityRecordedEvent());
    add(const SessionStatsChangedEvent());
  }

  void _handleBubbleTrigger(String source, {NormRect? crop}) {
    final now = DateTime.now();
    if (now.difference(_lastBubbleTrigger) < const Duration(seconds: 1)) return;
    _lastBubbleTrigger = now;
    add(TriggerScreenCaptureEvent(triggerSource: source, crop: crop));
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
    emit(state.copyWith(isOverlayRunning: false));
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
      await _persistAndSync(frame, emit);
    } catch (e) {
      emit(state.copyWith(
          status: CaptureStatus.failure, errorMessage: e.toString()));
    }
  }

  /// Persists a captured frame and pushes it through the sync pipeline
  /// (LAN hub / Drive per current sync mode). Shared by tap-capture and
  /// region-crop commit so both take the exact same delivery path.
  Future<void> _persistAndSync(
      CapturedFrame frame, Emitter<ScreenCaptureState> emit) async {
    final cacheId = await _persistFrame(frame);

    // Live-bridge: every successful capture (regardless of where it ends up)
    // bumps the session counter so the hero stats stay accurate.
    _metrics.incrementCaptures();
    add(const SessionStatsChangedEvent());

    // Each transport is isolated so a hub-side exception can never skip
    // the Drive fallback (hybrid mode), and vice versa.
    var hubOk = false;
    var driveOk = false;
    if (state.syncMode == SyncMode.lanMdns ||
        state.syncMode == SyncMode.hybrid) {
      try {
        hubOk = await _screenRepository.pushToLocalMcpServer(frame);
      } catch (_) {
        hubOk = false;
      }
      if (cacheId != null && hubOk) {
        await _cacheRepo.markSyncedHub(cacheId);
        _metrics.incrementHubPush();
        add(const SessionStatsChangedEvent());
      }
    }
    if (!hubOk &&
        (state.syncMode == SyncMode.googleDrive ||
            state.syncMode == SyncMode.hybrid)) {
      try {
        await _screenRepository.uploadToGoogleDrive(frame);
        driveOk = true;
        if (cacheId != null) await _cacheRepo.markSyncedDrive(cacheId);
        _metrics.incrementDrivePush();
        add(const SessionStatsChangedEvent());
      } catch (_) {
        driveOk = false;
      }
    }
    if (!hubOk && !driveOk) {
      if (state.syncMode == SyncMode.lanMdns) {
        throw StateError(
          'Captured the screen, but could not reach the desktop ScreenSync '
          'hub at ${_screenRepository.hubUrl}. Open Settings → Hub to pick one.',
        );
      }
      throw StateError(
        'Captured the screen and saved it locally, but neither the desktop '
        'hub nor Google Drive could be reached. Use Sync pending to retry.',
      );
    }

    final gallery = await _cacheRepo.recentFrames();
    final unsynced = await _cacheRepo.unsyncedHubCount();
    _metrics.setUnsynced(unsynced);
    add(const SessionStatsChangedEvent());
    emit(state.copyWith(
      status: CaptureStatus.success,
      errorMessage: null,
      gallery: gallery,
      latestFramePath:
          gallery.isEmpty ? state.latestFramePath : gallery.first.filePath,
      unsyncedCount: unsynced,
    ));
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
      await _persistAndSync(frame, emit);
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

  /// Writes frame + thumbnail into app storage and the SQLite history.
  Future<int?> _persistFrame(CapturedFrame frame) async {
    try {
      final docs = await getApplicationDocumentsDirectory();
      final path = await CapturePipeline.persist(
          frame.imageBytes, frame.filename, docs.path);
      CaptureTriggerBridge.writeLatestFramePointer(path).ignore();
      final thumbBytes = await CapturePipeline.thumbnail(frame.imageBytes);
      final tdir = await _cacheRepo.thumbsDir;
      final base = frame.filename.replaceAll(RegExp(r'\.(png|jpg)$'), '');
      final thumbFile = io.File('${tdir.path}/t_$base.png');
      await thumbFile.writeAsBytes(thumbBytes, flush: true);
      return _cacheRepo.saveFrame(
        filename: frame.filename,
        filePath: path,
        width: frame.width,
        height: frame.height,
        byteLength: frame.imageBytes.lengthInBytes,
        thumbPath: thumbFile.path,
      );
    } catch (e) {
      debugPrint('Frame cache persist failed: $e');
      return null;
    }
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

  Future<void> _onLoadGallery(
      LoadGalleryEvent event, Emitter<ScreenCaptureState> emit) async {
    final frames = await _cacheRepo.recentFrames();
    final unsynced = await _cacheRepo.unsyncedHubCount();
    _metrics.setUnsynced(unsynced);
    emit(state.copyWith(
      gallery: frames,
      unsyncedCount: unsynced,
      latestFramePath:
          frames.isEmpty ? state.latestFramePath : frames.first.filePath,
      telemetry: _settings.telemetryLog,
      sessionStats: _metrics.sessionStats,
      activityFeed: _metrics.activityFeed,
      latencyHistory: _metrics.latencyHistory,
    ));
  }

  /// Processes notification-action snaps (captured while the UI was closed)
  /// plus any older unsynced rows, pushing them to the hub.
  Future<void> _onSyncPending(
      SyncPendingEvent event, Emitter<ScreenCaptureState> emit) async {
    final drained = await DeviceIntentService.drainPendingSnaps();
    var pushed = 0;
    for (final bytes in drained) {
      try {
        final frame = CapturedFrame(imageBytes: bytes, mimeType: 'image/png');
        final id = await _persistFrame(frame);
        if (await _screenRepository.pushToLocalMcpServer(frame)) {
          if (id != null) await _cacheRepo.markSyncedHub(id);
          pushed++;
        }
      } catch (_) {/* keep pushing the rest */}
    }
    // Backlog: captured frames whose first push failed (hub was down).
    if (await _screenRepository.pingHub()) {
      for (final entry in await _cacheRepo.unsyncedHubFrames()) {
        try {
          final file = io.File(entry.filePath);
          if (!await file.exists()) continue;
          final frame = CapturedFrame(
            imageBytes: await file.readAsBytes(),
            filename: entry.filename,
            timestamp: entry.capturedAt,
            mimeType:
                entry.filename.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
          );
          if (await _screenRepository.pushToLocalMcpServer(frame)) {
            await _cacheRepo.markSyncedHub(entry.id);
            pushed++;
          }
        } catch (_) {/* keep pushing the rest */}
      }
    }
    emit(state.copyWith(
      gallery: await _cacheRepo.recentFrames(),
      unsyncedCount: await _cacheRepo.unsyncedHubCount(),
      errorMessage: pushed > 0
          ? 'Synced $pushed frame(s) to the hub.'
          : state.errorMessage,
    ));
  }

  Future<void> _onDeleteFrame(
      DeleteFrameEvent event, Emitter<ScreenCaptureState> emit) async {
    await _cacheRepo.deleteFrame(event.entry);
    final frames = await _cacheRepo.recentFrames();
    emit(state.copyWith(
      gallery: frames,
      unsyncedCount: await _cacheRepo.unsyncedHubCount(),
      latestFramePath:
          frames.isEmpty ? state.latestFramePath : frames.first.filePath,
    ));
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
    _liveSub?.cancel();
    _liveConnSub?.cancel();
    _stateSub?.cancel();
    _latencySampler?.cancel();
    LiveEventService.instance.disconnect();
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
    if (state.hubUrl.isEmpty) return;
    try {
      final res = await _screenRepository.pingHubTimed(
          timeout: const Duration(seconds: 2));
      if (res.ok && res.ms > 0) {
        _metrics.recordLatency(res.ms);
        add(LatencySampledEvent(res.ms));
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
}
