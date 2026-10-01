import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:screensync_flutter_project/services/live_event_service.dart';

/// Real loopback SSE server: the service is exercised end to end (request line,
/// headers, framing, reconnect), with a short watchdog so the silent-stream case
/// finishes in milliseconds instead of the production 90 seconds.
void main() {
  HttpOverrides.global = null; // flutter_test would otherwise stub HttpClient

  late HttpServer server;
  late LiveEventService service;
  final requests = <HttpRequest>[];
  final sockets = <HttpResponse>[];
  late Future<void> Function(HttpRequest request) onRequest;

  Future<HttpServer> start(Future<void> Function(HttpRequest) handler) async {
    final s = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    s.listen((req) {
      requests.add(req);
      handler(req);
    });
    return s;
  }

  Future<void> sse(HttpRequest req, {String first = ': hello\n\n'}) async {
    req.response.headers.contentType = ContentType('text', 'event-stream');
    req.response.bufferOutput = false;
    req.response.write(first);
    await req.response.flush();
    sockets.add(req.response);
  }

  String baseOf(HttpServer s) => 'http://127.0.0.1:${s.port}';

  setUp(() async {
    requests.clear();
    sockets.clear();
    onRequest = (req) => sse(req);
    server = await start((req) => onRequest(req));
    // Generous margins: the suite runs beside many others on a busy machine.
    service = LiveEventService.forTesting(
        watchdog: const Duration(milliseconds: 600));
  });

  tearDown(() async {
    service.disconnect();
    // A copy: a reconnect racing the teardown may still add a socket.
    for (final r in List.of(sockets)) {
      try {
        await r.close();
      } catch (_) {}
    }
    await server.close(force: true);
  });

  Future<void> until(bool Function() cond,
      {Duration timeout = const Duration(seconds: 12)}) async {
    final end = DateTime.now().add(timeout);
    while (!cond()) {
      if (DateTime.now().isAfter(end)) fail('condition not met in $timeout');
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
  }

  test('opens the stream as the phone: ?client=app with a bearer token',
      () async {
    service.connect(baseOf(server), 'tok-9');
    await until(() => requests.isNotEmpty);

    final req = requests.first;
    expect(req.uri.path, '/api/events');
    expect(req.uri.queryParameters['client'], 'app');
    expect(req.headers.value('authorization'), 'Bearer tok-9');
    expect(req.headers.value('accept'), contains('text/event-stream'));
  });

  test('parses pushed events', () async {
    final events = <LiveHubEvent>[];
    final sub = service.events.listen(events.add);
    onRequest = (req) => sse(req,
        first: 'data: ${jsonEncode({'type': 'frame', 'ok': true})}\n\n');

    service.connect(baseOf(server), 't');
    await until(() => events.isNotEmpty);

    expect(events.first.type, 'frame');
    await sub.cancel();
  });

  test('a stream that goes silent is dropped and reopened (watchdog)',
      () async {
    final states = <bool>[];
    final sub = service.connectionState.listen(states.add);
    // Answers once, then says nothing: no bytes, not even a keepalive.
    onRequest = (req) => sse(req);

    service.connect(baseOf(server), 't');
    await until(() => requests.length >= 2);

    expect(states, contains(true));
    expect(states, contains(false),
        reason: 'the stalled stream must be reported as down before retrying');
    await sub.cancel();
  });

  test('keepalive comments count as traffic and keep the stream open',
      () async {
    onRequest = (req) async {
      await sse(req);
      unawaited(() async {
        // Well inside the 600 ms test watchdog.
        for (var i = 0; i < 40; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 50));
          try {
            req.response.write(': keepalive\n\n');
            await req.response.flush();
          } catch (_) {
            return;
          }
        }
      }());
    };

    service.connect(baseOf(server), 't');
    // Longer than the watchdog: without keepalives this would have reconnected.
    await Future<void>.delayed(const Duration(milliseconds: 1500));

    expect(requests, hasLength(1), reason: 'no needless reconnect');
  });

  test('a quick hub switch cannot leave the old loop flipping the state',
      () async {
    final slow = await start((req) async {
      // Never answers: the old connect is still in flight when we switch.
      sockets.add(req.response);
    });
    final states = <bool>[];
    final sub = service.connectionState.listen(states.add);

    service.connect(baseOf(slow), 't');
    await until(() => requests.isNotEmpty);
    service.connect(baseOf(server), 't'); // switch while the first is pending

    await until(() => states.contains(true));
    await Future<void>.delayed(const Duration(milliseconds: 150));

    expect(states.last, isTrue,
        reason: 'a stale loop must not report "down" after the new one is up');
    expect(requests.where((r) => r.connectionInfo?.localPort == server.port),
        isNotEmpty);
    await sub.cancel();
    await slow.close(force: true);
  });

  test('disconnect stops reconnecting', () async {
    service.connect(baseOf(server), 't');
    await until(() => requests.isNotEmpty);

    service.disconnect();
    final seen = requests.length;
    await Future<void>.delayed(const Duration(milliseconds: 400));

    expect(requests.length, seen);
  });
}
