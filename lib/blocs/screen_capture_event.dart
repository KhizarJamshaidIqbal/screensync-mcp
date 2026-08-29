import 'package:equatable/equatable.dart';

import '../models/capture_quality.dart';
import '../models/frame_entry.dart';
import '../repositories/sync_mode.dart';
import '../services/capture_pipeline_service.dart';
import '../services/hub_discovery_service.dart';

abstract class ScreenCaptureEvent extends Equatable {
  const ScreenCaptureEvent();
  @override
  List<Object?> get props => [];
}

class StartOverlayServiceEvent extends ScreenCaptureEvent {}

class StopOverlayServiceEvent extends ScreenCaptureEvent {}

class TriggerScreenCaptureEvent extends ScreenCaptureEvent {
  final String triggerSource;
  final CaptureQuality? quality;
  final NormRect? crop;
  const TriggerScreenCaptureEvent({
    this.triggerSource = 'floating_bubble',
    this.quality,
    this.crop,
  });

  @override
  List<Object?> get props => [triggerSource, quality, crop];
}

/// Long-press on the bubble: capture the full display now and hand the raw
/// bytes to the UI so it can open the full-screen region crop editor.
class RegionSelectRequestedEvent extends ScreenCaptureEvent {
  final String triggerSource;
  const RegionSelectRequestedEvent({this.triggerSource = 'region_selector'});
  @override
  List<Object?> get props => [triggerSource];
}

/// User confirmed a crop rect in the region editor: crop the already-captured
/// frame and run it through the normal persist + sync pipeline.
class CommitRegionCropEvent extends ScreenCaptureEvent {
  final NormRect rect;
  const CommitRegionCropEvent(this.rect);
  @override
  List<Object?> get props => [rect];
}

/// Clears the pending region frame after the editor is dismissed/handled.
class ClearRegionRequestEvent extends ScreenCaptureEvent {
  const ClearRegionRequestEvent();
}

class ToggleSyncModeEvent extends ScreenCaptureEvent {
  final SyncMode mode;
  const ToggleSyncModeEvent(this.mode);
  @override
  List<Object?> get props => [mode];
}

class SetQualityEvent extends ScreenCaptureEvent {
  final CaptureQuality quality;
  const SetQualityEvent(this.quality);
  @override
  List<Object?> get props => [quality];
}

class PingHubEvent extends ScreenCaptureEvent {}

class DiscoverHubsEvent extends ScreenCaptureEvent {}

/// One-tap "Connect now" from the dashboard: clears any stale emulator-only
/// override, runs mDNS discovery and connects to the found hub.
class AutoConnectHubEvent extends ScreenCaptureEvent {}

/// One-tap "Disconnect" from the app bar: tears down the active hub link so
/// the ScreenSync MCP server connection is fully closed (it no longer stays
/// on all the time). Clears the hub URL + pairing token, drops the live SSE
/// stream, and marks the hub as offline.
class DisconnectHubEvent extends ScreenCaptureEvent {}

class SelectHubEvent extends ScreenCaptureEvent {
  final DiscoveredHub hub;
  const SelectHubEvent(this.hub);
  @override
  List<Object?> get props => [hub];
}

class SetHubUrlEvent extends ScreenCaptureEvent {
  final String url;
  const SetHubUrlEvent(this.url);
  @override
  List<Object?> get props => [url];
}

class SetPairingTokenEvent extends ScreenCaptureEvent {
  final String token;
  const SetPairingTokenEvent(this.token);
  @override
  List<Object?> get props => [token];
}

class LoadGalleryEvent extends ScreenCaptureEvent {}

class SyncPendingEvent extends ScreenCaptureEvent {}

/// Removes a captured frame locally (SQLite row + thumbnail + full file).
class DeleteFrameEvent extends ScreenCaptureEvent {
  final FrameEntry entry;
  const DeleteFrameEvent(this.entry);
  @override
  List<Object?> get props => [entry];
}

class FetchDiagnosisEvent extends ScreenCaptureEvent {}

/// Refresh = pull latest telemetry rows; clear = wipe the persisted log.
class ClearTelemetryEvent extends ScreenCaptureEvent {
  final bool refreshOnly;
  const ClearTelemetryEvent.refresh() : refreshOnly = true;
  const ClearTelemetryEvent.clear() : refreshOnly = false;
  @override
  List<Object?> get props => [refreshOnly];
}

class OverlayBubbleToggledExternally extends ScreenCaptureEvent {
  final bool running;
  const OverlayBubbleToggledExternally(this.running);
  @override
  List<Object?> get props => [running];
}

/// Pushed by the hub over SSE when a frame/inspection/patch lands.
class LiveHubEventEvent extends ScreenCaptureEvent {
  final String type;
  final String? label;
  final bool ok;
  final String? agentName;
  const LiveHubEventEvent(this.type, {this.label, this.ok = true, this.agentName});
  @override
  List<Object?> get props => [type, label, ok, agentName];
}

class LiveConnectionEvent extends ScreenCaptureEvent {
  final bool connected;
  const LiveConnectionEvent(this.connected);
  @override
  List<Object?> get props => [connected];
}

// ── Live-bridge additions (ConnectionHero 2.0) ──
//
// These are the events the metrics service publishes back into the BLoC
// after recording a sample. They are emitted by the BLoC itself (not the
// UI) so the handler body just copies the new list/stats from the service
// into state — keeping the service the single source of truth.

/// Pushed by the periodic latency sampler (~ every 5s) with the most
/// recent ping round-trip in ms. Ignored if non-positive (a failed ping).
class LatencySampledEvent extends ScreenCaptureEvent {
  final int ms;
  const LatencySampledEvent(this.ms);
  @override
  List<Object?> get props => [ms];
}

/// User tapped "Capture now" on the hero quick-actions row.
class QuickCaptureRequestedEvent extends ScreenCaptureEvent {}

/// User tapped "Sync pending" on the hero quick-actions row.
class QuickSyncRequestedEvent extends ScreenCaptureEvent {}

/// User tapped "Ping hub" on the hero quick-actions row.
class QuickPingRequestedEvent extends ScreenCaptureEvent {}

/// User tapped "Retry" on the unsynced tile.
class RetryUnsyncedRequestedEvent extends ScreenCaptureEvent {}

/// Activity was recorded by the metrics service (an SSE event, capture
/// success, hub reconnect, etc.). The BLoC handler just re-emits the new
/// feed list into state.
class ActivityRecordedEvent extends ScreenCaptureEvent {
  const ActivityRecordedEvent();
}

/// Session stats were updated (capture counter, push counter, AI response
/// timestamp). Same pattern as above.
class SessionStatsChangedEvent extends ScreenCaptureEvent {
  const SessionStatsChangedEvent();
}

/// F2: Emitted internally when device_info_plus resolves the Android device
/// model. No-op on desktop / non-Android platforms.
class DeviceNameResolvedEvent extends ScreenCaptureEvent {
  final String name;
  const DeviceNameResolvedEvent(this.name);
  @override
  List<Object?> get props => [name];
}
