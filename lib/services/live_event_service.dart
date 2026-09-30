import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// One pushed hub event (frame uploaded / inspection / patch published).
class LiveHubEvent {
  final String type;
  final DateTime at;

  /// Optional detail (e.g. the MCP tool name for `tool` events).
  final String? label;
  final bool ok;

  /// Connected AI agent name (e.g. "Claude Desktop", "Claude Code") surfaced
  /// on the Connection Hero "Your AI" label. Null until agent_connect arrives.
  final String? agentName;

  const LiveHubEvent({
    required this.type,
    required this.at,
    this.label,
    this.ok = true,
    this.agentName,
  });
}

/// Keeps a single persistent SSE connection to the hub's /api/events so the
/// app reacts instantly instead of polling. Reconnects with exponential
/// backoff (1s → 30s).
///
/// The stream is opened as `?client=app` so the hub can tell the phone from a
/// browser extension and report an honest "phone online" status. A read
/// watchdog drops a stream that goes silent (the hub sends `: keepalive`
/// comments, which count as traffic) so a half-dead socket cannot leave
/// "SSE Live" on forever.
class LiveEventService {
  LiveEventService._()
      : watchdog = const Duration(seconds: 90),
        _baseBackoffMs = 1000;
  static final LiveEventService instance = LiveEventService._();

  /// Separate instance with a short watchdog/backoff for unit tests.
  @visibleForTesting
  LiveEventService.forTesting({
    this.watchdog = const Duration(milliseconds: 200),
    int baseBackoffMs = 20,
  }) : _baseBackoffMs = baseBackoffMs;

  /// No bytes for this long (keepalive comments included) => reconnect.
  final Duration watchdog;
  final int _baseBackoffMs;

  final _events = StreamController<LiveHubEvent>.broadcast();
  final _connection = StreamController<bool>.broadcast();

  Stream<LiveHubEvent> get events => _events.stream;
  Stream<bool> get connectionState => _connection.stream;

  bool _wanted = false;

  /// True while a connect loop for the current [_generation] exists.
  bool _running = false;

  /// Bumped by every connect()/disconnect(); a loop whose generation is stale
  /// stops without touching shared state, which is what makes a quick
  /// hub-URL switch safe (the old loop can no longer flip the new one's state).
  int _generation = 0;
  late int _backoffMs = _baseBackoffMs;
  String? _url;
  String? _token;
  http.Client? _client;

  void connect(String baseUrl, String token) {
    if (_wanted && _url == baseUrl && _token == token && _running) return;
    _wanted = true;
    _url = baseUrl;
    _token = token;
    _backoffMs = _baseBackoffMs;
    _closeClient();
    _running = true;
    _run(++_generation);
  }

  void disconnect() {
    _wanted = false;
    _running = false;
    _generation++;
    _closeClient();
    _connection.add(false);
  }

  void _closeClient() {
    _client?.close();
    _client = null;
  }

  Future<void> _run(int generation) async {
    while (_wanted && generation == _generation) {
      await _streamOnce(generation);
      if (!_wanted || generation != _generation) break;
      await Future<void>.delayed(Duration(milliseconds: _backoffMs));
      _backoffMs = (_backoffMs * 2).clamp(_baseBackoffMs, 30000);
    }
    if (generation == _generation) _running = false;
  }

  Future<void> _streamOnce(int generation) async {
    final url = _url;
    if (url == null) return;
    final client = http.Client();
    _client = client;
    try {
      final request = http.Request('GET', Uri.parse('$url/api/events?client=app'));
      request.headers['Authorization'] = 'Bearer $_token';
      request.headers['Accept'] = 'text/event-stream';
      final response = await client.send(request);
      if (generation != _generation) return;
      if (response.statusCode != 200) {
        throw StateError('SSE status ${response.statusCode}');
      }
      _backoffMs = _baseBackoffMs;
      _connection.add(true);
      final guarded = response.stream.timeout(
        watchdog,
        onTimeout: (sink) {
          sink.addError(TimeoutException('SSE stream went silent'));
          sink.close();
        },
      );
      final buffer = StringBuffer();
      await for (final chunk in guarded.transform(const Utf8Decoder())) {
        if (!_wanted || generation != _generation) break;
        buffer.write(chunk);
        var text = buffer.toString();
        while (text.contains('\n\n')) {
          final idx = text.indexOf('\n\n');
          final block = text.substring(0, idx);
          text = text.substring(idx + 2);
          _parseBlock(block);
        }
        buffer
          ..clear()
          ..write(text);
      }
    } catch (_) {/* reconnect in _run */}
    client.close();
    if (identical(_client, client)) _client = null;
    if (generation == _generation) _connection.add(false);
  }

  void _parseBlock(String block) {
    for (final line in block.split('\n')) {
      if (!line.startsWith('data:')) continue;
      try {
        final decoded = jsonDecode(line.substring(5).trim());
        if (decoded is Map<String, dynamic>) {
          _events.add(LiveHubEvent(
            type: decoded['type']?.toString() ?? '',
            at: DateTime.tryParse(decoded['at']?.toString() ?? '') ??
                DateTime.now(),
            label: decoded['label']?.toString(),
            ok: decoded['ok'] != false,
            agentName: decoded['agentName']?.toString(),
          ));
        }
      } catch (_) {/* malformed event line */}
    }
  }
}
