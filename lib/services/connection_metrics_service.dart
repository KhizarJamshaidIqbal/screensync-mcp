import 'dart:collection';
import 'package:equatable/equatable.dart';

/// A single event the desktop hub pushed over SSE, surfaced on the phone so
/// the user can see what their AI is actually doing in near real-time.
class ActivityEvent extends Equatable {
  const ActivityEvent({
    required this.kind,
    required this.label,
    required this.timestamp,
  });

  /// 'inspection' | 'patch' | 'frame' | 'connected' | 'disconnected'
  final String kind;
  final String label;
  final DateTime timestamp;

  @override
  List<Object?> get props => [kind, label, timestamp];
}

/// Aggregate counters for the current app session. Reset on cold start —
/// not persisted, so users always see a "fresh today" view.
class SessionStats extends Equatable {
  const SessionStats({
    this.capturesToday = 0,
    this.pushedHub = 0,
    this.pushedDrive = 0,
    this.unsynced = 0,
    this.lastAIResponse,
  });

  final int capturesToday;
  final int pushedHub;
  final int pushedDrive;
  final int unsynced;
  final DateTime? lastAIResponse;

  SessionStats copyWith({
    int? capturesToday,
    int? pushedHub,
    int? pushedDrive,
    int? unsynced,
    Object? lastAIResponse = _sentinel,
  }) {
    return SessionStats(
      capturesToday: capturesToday ?? this.capturesToday,
      pushedHub: pushedHub ?? this.pushedHub,
      pushedDrive: pushedDrive ?? this.pushedDrive,
      unsynced: unsynced ?? this.unsynced,
      lastAIResponse: identical(lastAIResponse, _sentinel)
          ? this.lastAIResponse
          : lastAIResponse as DateTime?,
    );
  }

  static const _sentinel = Object();

  @override
  List<Object?> get props =>
      [capturesToday, pushedHub, pushedDrive, unsynced, lastAIResponse];
}

/// Health bucket derived from current latency, surfaced as the colored pill
/// the user sees in the hero card.
enum LinkHealth { excellent, good, slow, poor, offline }

extension LinkHealthLabel on LinkHealth {
  String get label => switch (this) {
        LinkHealth.excellent => 'Excellent',
        LinkHealth.good => 'Good',
        LinkHealth.slow => 'Slow',
        LinkHealth.poor => 'Poor',
        LinkHealth.offline => 'Offline',
      };
}

/// Pure-Dart rolling-buffer service. No Flutter imports — kept in `services/`
/// only because BLoC + UI consume it; it stays unit-testable without a binding.
///
/// Why: BLoC handlers would otherwise need to mutate List<int> inline, with
/// all the copyWith + cap logic duplicated. Centralising it keeps the buffer
/// cap, the eviction order, and the health thresholds in one place.
class ConnectionMetricsService {
  ConnectionMetricsService({
    this.latencyWindow = 60,
    this.activityWindow = 20,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  /// Number of latency samples kept in the rolling sparkline buffer.
  /// 60 samples × 5s sampling = 5 minutes of history.
  final int latencyWindow;

  /// Number of activity events kept in the feed.
  final int activityWindow;

  final DateTime Function() _clock;

  final Queue<int> _latency = Queue<int>();
  final ListQueue<ActivityEvent> _activity = ListQueue<ActivityEvent>();
  SessionStats _stats = const SessionStats();

  // Read-only views for BLoC / UI.
  List<int> get latencyHistory => List<int>.unmodifiable(_latency);
  List<ActivityEvent> get activityFeed =>
      List<ActivityEvent>.unmodifiable(_activity);
  SessionStats get sessionStats => _stats;

  // ── Latency ────────────────────────────────────────────────────────────

  /// Append a new sample. Older entries beyond [latencyWindow] are dropped
  /// from the head (FIFO). Non-positive values are ignored — those are
  /// "no measurement" placeholders, not real samples.
  void recordLatency(int ms) {
    if (ms <= 0) return;
    _latency.addLast(ms);
    while (_latency.length > latencyWindow) {
      _latency.removeFirst();
    }
  }

  /// Clear the latency history — e.g. on hub URL change so a fresh host
  /// doesn't show a stale sparkline.
  void clearLatency() => _latency.clear();

  /// Average of the buffered samples; null if no samples.
  int? get averageLatency {
    if (_latency.isEmpty) return null;
    final sum = _latency.fold<int>(0, (a, b) => a + b);
    return sum ~/ _latency.length;
  }

  /// Worst sample in the window. Null if empty.
  int? get peakLatency =>
      _latency.isEmpty ? null : _latency.reduce((a, b) => a > b ? a : b);

  /// Classify the current link into one of five buckets.
  ///
  /// Thresholds picked from common LAN Wi-Fi RTT distributions: <100ms
  /// is "feels instant", <300ms is "fine for any UI", <800ms is "noticeable",
  /// ≥800ms is "something is wrong". These match the bands shown on the
  /// hero card and the colored sparkline.
  LinkHealth classifyHealth({required bool online, int? latestMs}) {
    if (!online) return LinkHealth.offline;
    final ms = latestMs ?? averageLatency;
    if (ms == null) return LinkHealth.good; // online but no sample yet
    if (ms < 100) return LinkHealth.excellent;
    if (ms < 300) return LinkHealth.good;
    if (ms < 800) return LinkHealth.slow;
    return LinkHealth.poor;
  }

  // ── Activity feed ──────────────────────────────────────────────────────

  /// Push a new event. Evicts the oldest if at capacity.
  void recordActivity(ActivityEvent event) {
    _activity.addLast(event);
    while (_activity.length > activityWindow) {
      _activity.removeFirst();
    }
  }

  void clearActivity() => _activity.clear();

  // ── Session stats ──────────────────────────────────────────────────────

  void incrementCaptures() {
    _stats = _stats.copyWith(capturesToday: _stats.capturesToday + 1);
  }

  void incrementHubPush() {
    _stats = _stats.copyWith(pushedHub: _stats.pushedHub + 1);
  }

  void incrementDrivePush() {
    _stats = _stats.copyWith(pushedDrive: _stats.pushedDrive + 1);
  }

  void setUnsynced(int count) {
    if (_stats.unsynced == count) return;
    _stats = _stats.copyWith(unsynced: count);
  }

  void recordAIResponse() {
    _stats = _stats.copyWith(lastAIResponse: _clock());
  }

  void clearStats() => _stats = const SessionStats();

  /// For tests: reset everything.
  void reset() {
    _latency.clear();
    _activity.clear();
    _stats = const SessionStats();
  }
}
