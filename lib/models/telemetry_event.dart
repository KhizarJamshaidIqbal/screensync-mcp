/// One observability record for the JSON-RPC / upload telemetry stream.
class TelemetryEvent {
  final String kind; // upload | discovery | vision | patch
  final String label;
  final int durationMs;
  final bool ok;
  final DateTime timestamp;

  const TelemetryEvent({
    required this.kind,
    required this.label,
    required this.durationMs,
    required this.ok,
    required this.timestamp,
  });

  Map<String, dynamic> toJson() => {
        'kind': kind,
        'label': label,
        'durationMs': durationMs,
        'ok': ok,
        'timestamp': timestamp.toIso8601String(),
      };

  factory TelemetryEvent.fromJson(Map<String, dynamic> json) => TelemetryEvent(
        kind: json['kind'] as String? ?? 'unknown',
        label: json['label'] as String? ?? '',
        durationMs: (json['durationMs'] as num?)?.toInt() ?? -1,
        ok: json['ok'] as bool? ?? false,
        timestamp: DateTime.tryParse(json['timestamp'] as String? ?? '') ??
            DateTime.now(),
      );

  /// Ring-buffer cap so SharedPreferences payloads stay small.
  static const int maxStored = 30;
}
