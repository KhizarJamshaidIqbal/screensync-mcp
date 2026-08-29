import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'connection_metrics_service.dart';

/// D3: records a control session (every tool call / frame event that flows
/// through the activity pipeline while armed) and exports it as a
/// reproducible MCP script — a JSON list of steps any agent can replay.
class SessionRecorderService extends ChangeNotifier {
  SessionRecorderService._();
  static final SessionRecorderService instance = SessionRecorderService._();

  bool _recording = false;
  DateTime? _startedAt;
  final List<ActivityEvent> _steps = [];

  bool get recording => _recording;
  int get stepCount => _steps.length;
  DateTime? get startedAt => _startedAt;

  void start() {
    _steps.clear();
    _startedAt = DateTime.now();
    _recording = true;
    notifyListeners();
  }

  void stop() {
    _recording = false;
    notifyListeners();
  }

  /// Called by the BLoC whenever an activity event lands.
  void observe(ActivityEvent event) {
    if (!_recording) return;
    _steps.add(event);
    notifyListeners();
  }

  /// Reproducible MCP script: agents replay each `tool` step in order.
  String exportScript({required String hubUrl}) {
    final start = _startedAt ?? DateTime.now();
    final steps = <Map<String, dynamic>>[];
    for (final e in _steps) {
      steps.add({
        'offsetMs': e.timestamp.difference(start).inMilliseconds,
        'kind': e.kind,
        if (e.kind == 'tool') 'tool': e.label else 'label': e.label,
      });
    }
    return const JsonEncoder.withIndent('  ').convert({
      'format': 'screensync-mcp-script/v1',
      'recordedAt': start.toIso8601String(),
      'hubUrl': hubUrl,
      'replayHint':
          'For each step with a "tool" field, invoke that MCP tool in order '
          '(respecting offsetMs pacing) against the ScreenSync hub.',
      'steps': steps,
    });
  }

  void clear() {
    _steps.clear();
    _startedAt = null;
    _recording = false;
    notifyListeners();
  }
}
