import 'dart:async';
import 'dart:convert';

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
class LiveEventService {
  LiveEventService._();
  static final LiveEventService instance = LiveEventService._();

  final _events = StreamController<LiveHubEvent>.broadcast();
  final _connection = StreamController<bool>.broadcast();

  Stream<LiveHubEvent> get events => _events.stream;
  Stream<bool> get connectionState => _connection.stream;

  bool _wanted = false;
  bool _connecting = false;
  int _backoffMs = 1000;
  String? _url;
  String? _token;
  http.Client? _client;

  void connect(String baseUrl, String token) {
    if (_wanted && _url == baseUrl && _token == token && _client != null) {
      return;
    }
    _wanted = true;
    _url = baseUrl;
    _token = token;
    _backoffMs = 1000;
    _client?.close();
    _client = null;
    _open();
  }

  void disconnect() {
    _wanted = false;
    _client?.close();
    _client = null;
    _connection.add(false);
  }

  Future<void> _open() async {
    if (!_wanted || _connecting || _url == null) return;
    _connecting = true;
    final client = http.Client();
    _client = client;
    try {
      final request = http.Request('GET', Uri.parse('$_url/api/events'));
      request.headers['Authorization'] = 'Bearer $_token';
      request.headers['Accept'] = 'text/event-stream';
      final response = await client.send(request);
      if (response.statusCode != 200) {
        throw StateError('SSE status ${response.statusCode}');
      }
      _backoffMs = 1000;
      _connection.add(true);
      final buffer = StringBuffer();
      await for (final chunk
          in response.stream.transform(const Utf8Decoder())) {
        if (!_wanted) break;
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
    } catch (_) {/* reconnect below */}
    _connection.add(false);
    client.close();
    if (_client == client) _client = null;
    _connecting = false;
    if (_wanted) {
      await Future<void>.delayed(Duration(milliseconds: _backoffMs));
      _backoffMs = (_backoffMs * 2).clamp(1000, 30000);
      _open();
    }
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
