import 'dart:typed_data';

import 'package:equatable/equatable.dart';

import '../models/bug_region.dart';
import '../models/capture_quality.dart';
import '../models/captured_frame.dart';
import '../models/frame_entry.dart';
import '../models/telemetry_event.dart';
import '../repositories/sync_mode.dart';
import '../services/connection_metrics_service.dart';
import '../services/hub_discovery_service.dart';

enum CaptureStatus { idle, capturing, uploading, success, failure }

class ScreenCaptureState extends Equatable {
  final CaptureStatus status;
  final SyncMode syncMode;
  final CaptureQuality quality;
  final bool isOverlayRunning;
  final CapturedFrame? latestFrame;
  final String? latestFramePath;
  final String? errorMessage;
  final String hubUrl;
  final bool? hubOnline;
  final String hubSource;
  final int? hubLatencyMs;
  final bool discovering;
  final List<DiscoveredHub> discoveredHubs;
  final List<FrameEntry> gallery;
  final int unsyncedCount;
  final List<BugRegion> bugRegions;
  final Map<String, dynamic>? patch;
  final List<TelemetryEvent> telemetry;
  final bool liveConnected;

  /// Raw bytes of a full-screen frame captured by a bubble long-press,
  /// waiting for the user to pick a crop region in the editor.
  final Uint8List? regionBytes;

  /// Monotonic id bumped on each region-select request so the UI opens the
  /// crop editor exactly once per long-press (nonce pattern).
  final int regionRequestId;

  // ── Live-bridge additions ──
  // ConnectionHero 2.0 ("Live Bridge") — these are populated by the
  // ConnectionMetricsService via the BLoC. Kept as plain state so widget
  // tests don't have to spin up the full BLoC to render the hero.

  /// Rolling latency history (newest last). Bounded by the metrics service
  /// (default 60 samples).
  final List<int> latencyHistory;

  /// Aggregate session counters (captures today, hub pushes, drive pushes,
  /// unsynced, last AI response time).
  final SessionStats sessionStats;

  /// Most recent activity events pushed over SSE — last 5 are surfaced as
  /// a mini timeline; full ring is in the metrics service.
  final List<ActivityEvent> activityFeed;

  /// Android device model (e.g. "Pixel 7", "sdk gphone64 x86 64") — surfaced
  /// on the Connection Hero instead of a static "This phone" placeholder.
  final String? deviceName;

  /// Connected AI agent name (e.g. "Claude Desktop", "Claude Code") surfaced
  /// on the Connection Hero instead of a static "Your AI" placeholder.
  final String? agentName;

  // ── Live mirror / capture health ──

  /// True while a MediaProjection session is live and capture can work. Fed by
  /// the native projection-state stream and the periodic `isReady()` poll; it
  /// is what the bubble card and the mirror tile read instead of assuming.
  final bool captureReady;

  /// The device owner's live-mirror switch (mirrors the persisted setting, but
  /// only turns on after screen-capture consent was actually granted).
  final bool liveMirrorEnabled;

  /// The mirror is on but has been unable to capture for several ticks in a
  /// row (no projection session). Cleared by the first successful push.
  final bool mirrorWaiting;

  /// A screen-capture consent prompt is open (mirror switch or "Grant screen
  /// capture" button); the UI disables both while it is.
  final bool consentPending;

  /// When a frame last reached the hub (SSE `frame` event or this phone's own
  /// successful push), by the phone's clock.
  final DateTime? lastFrameAt;

  /// [lastFrameAt] is recent enough to call the stream live. Kept as state and
  /// refreshed by a periodic tick so a stalled stream flips back to "waiting"
  /// without needing another event.
  final bool framesFresh;

  /// The hub is reachable (`/health`) but refused an authenticated call, i.e.
  /// this phone's pairing token is wrong. `/health` alone cannot tell.
  final bool hubAuthFailed;

  const ScreenCaptureState({
    this.status = CaptureStatus.idle,
    this.syncMode = SyncMode.hybrid,
    this.quality = CaptureQuality.fast,
    this.isOverlayRunning = false,
    this.latestFrame,
    this.latestFramePath,
    this.errorMessage,
    this.hubUrl = '',
    this.hubOnline,
    this.hubSource = '',
    this.hubLatencyMs,
    this.discovering = false,
    this.discoveredHubs = const [],
    this.gallery = const [],
    this.unsyncedCount = 0,
    this.bugRegions = const [],
    this.patch,
    this.telemetry = const [],
    this.liveConnected = false,
    this.regionBytes,
    this.regionRequestId = 0,
    this.latencyHistory = const [],
    this.sessionStats = const SessionStats(),
    this.activityFeed = const [],
    this.deviceName,
    this.agentName,
    this.captureReady = false,
    this.liveMirrorEnabled = false,
    this.mirrorWaiting = false,
    this.consentPending = false,
    this.lastFrameAt,
    this.framesFresh = false,
    this.hubAuthFailed = false,
  });

  ScreenCaptureState copyWith({
    CaptureStatus? status,
    SyncMode? syncMode,
    CaptureQuality? quality,
    bool? isOverlayRunning,
    CapturedFrame? latestFrame,
    Object? latestFramePath = _sentinel,
    Object? errorMessage = _sentinel,
    String? hubUrl,
    bool? hubOnline,
    String? hubSource,
    int? hubLatencyMs,
    bool? discovering,
    List<DiscoveredHub>? discoveredHubs,
    List<FrameEntry>? gallery,
    int? unsyncedCount,
    List<BugRegion>? bugRegions,
    Object? patch = _sentinel,
    List<TelemetryEvent>? telemetry,
    bool? liveConnected,
    Object? regionBytes = _sentinel,
    int? regionRequestId,
    List<int>? latencyHistory,
    SessionStats? sessionStats,
    List<ActivityEvent>? activityFeed,
    String? deviceName,
    String? agentName,
    bool? captureReady,
    bool? liveMirrorEnabled,
    bool? mirrorWaiting,
    bool? consentPending,
    DateTime? lastFrameAt,
    bool? framesFresh,
    bool? hubAuthFailed,
  }) {
    return ScreenCaptureState(
      status: status ?? this.status,
      syncMode: syncMode ?? this.syncMode,
      quality: quality ?? this.quality,
      isOverlayRunning: isOverlayRunning ?? this.isOverlayRunning,
      latestFrame: latestFrame ?? this.latestFrame,
      latestFramePath: identical(latestFramePath, _sentinel)
          ? this.latestFramePath
          : latestFramePath as String?,
      errorMessage: identical(errorMessage, _sentinel)
          ? this.errorMessage
          : errorMessage as String?,
      hubUrl: hubUrl ?? this.hubUrl,
      hubOnline: hubOnline ?? this.hubOnline,
      hubSource: hubSource ?? this.hubSource,
      hubLatencyMs: hubLatencyMs ?? this.hubLatencyMs,
      discovering: discovering ?? this.discovering,
      discoveredHubs: discoveredHubs ?? this.discoveredHubs,
      gallery: gallery ?? this.gallery,
      unsyncedCount: unsyncedCount ?? this.unsyncedCount,
      bugRegions: bugRegions ?? this.bugRegions,
      patch: identical(patch, _sentinel)
          ? this.patch
          : patch as Map<String, dynamic>?,
      telemetry: telemetry ?? this.telemetry,
      liveConnected: liveConnected ?? this.liveConnected,
      regionBytes: identical(regionBytes, _sentinel)
          ? this.regionBytes
          : regionBytes as Uint8List?,
      regionRequestId: regionRequestId ?? this.regionRequestId,
      latencyHistory: latencyHistory ?? this.latencyHistory,
      sessionStats: sessionStats ?? this.sessionStats,
      activityFeed: activityFeed ?? this.activityFeed,
      deviceName: deviceName ?? this.deviceName,
      agentName: agentName ?? this.agentName,
      captureReady: captureReady ?? this.captureReady,
      liveMirrorEnabled: liveMirrorEnabled ?? this.liveMirrorEnabled,
      mirrorWaiting: mirrorWaiting ?? this.mirrorWaiting,
      consentPending: consentPending ?? this.consentPending,
      lastFrameAt: lastFrameAt ?? this.lastFrameAt,
      framesFresh: framesFresh ?? this.framesFresh,
      hubAuthFailed: hubAuthFailed ?? this.hubAuthFailed,
    );
  }

  static const _sentinel = Object();

  @override
  List<Object?> get props => [
        status,
        syncMode,
        quality,
        isOverlayRunning,
        latestFrame,
        latestFramePath,
        errorMessage,
        hubUrl,
        hubOnline,
        hubSource,
        hubLatencyMs,
        discovering,
        discoveredHubs,
        gallery,
        unsyncedCount,
        bugRegions,
        patch,
        telemetry,
        liveConnected,
        regionRequestId,
        latencyHistory,
        sessionStats,
        activityFeed,
        deviceName,
        agentName,
        captureReady,
        liveMirrorEnabled,
        mirrorWaiting,
        consentPending,
        lastFrameAt,
        framesFresh,
        hubAuthFailed,
      ];
}
