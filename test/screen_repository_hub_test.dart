import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:screensync_flutter_project/models/captured_frame.dart';
import 'package:screensync_flutter_project/repositories/screen_repository.dart';

/// `/health` is unauthenticated, so a reachable hub can still be rejecting this
/// phone's token. `checkHubAuth` is the one bearer-guarded probe that tells the
/// two apart, and the upload must name the real handset.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  ScreenRepository repo() => ScreenRepository()
    ..hubUrlResolver = (() => 'http://hub.test:3000')
    ..tokenResolver = (() => 'tok-1');

  Future<HubAuthStatus> checkWith(
      Future<http.Response> Function(http.Request) handler) {
    return http.runWithClient(
        () => repo().checkHubAuth(), () => MockClient(handler));
  }

  group('checkHubAuth', () {
    test('401 from an otherwise reachable hub is "rejected"', () async {
      expect(await checkWith((_) async => http.Response('{}', 401)),
          HubAuthStatus.rejected);
    });

    test('403 is "rejected" as well', () async {
      expect(await checkWith((_) async => http.Response('{}', 403)),
          HubAuthStatus.rejected);
    });

    test('200 is "ok"', () async {
      expect(await checkWith((_) async => http.Response('{}', 200)),
          HubAuthStatus.ok);
    });

    test('a 5xx is inconclusive, not an auth problem', () async {
      expect(await checkWith((_) async => http.Response('oops', 500)),
          HubAuthStatus.unknown);
    });

    test('a network failure is inconclusive, not an auth problem', () async {
      expect(
          await checkWith((_) async => throw const SocketException('down')),
          HubAuthStatus.unknown);
    });

    test('calls a bearer-guarded route with the phone token', () async {
      late http.Request seen;
      await checkWith((request) async {
        seen = request;
        return http.Response('{}', 200);
      });
      expect(seen.url.path, '/api/events/recent');
      expect(seen.headers['Authorization'], 'Bearer tok-1');
    });
  });

  group('upload deviceModel', () {
    CapturedFrame frame() => CapturedFrame(
        imageBytes: Uint8List.fromList(<int>[1, 2, 3]), mimeType: 'image/jpeg');

    Future<Map<String, dynamic>> uploadWith(
        Future<String> Function() loader) async {
      late Map<String, dynamic> body;
      final r = repo()..deviceModelLoader = loader;
      await http.runWithClient(() => r.pushToLocalMcpServer(frame()), () {
        return MockClient((request) async {
          body = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response('{}', 200);
        });
      });
      return body;
    }

    test('sends the real model, not the hard-coded string', () async {
      final body = await uploadWith(() async => 'Pixel 7');
      expect(body['deviceModel'], 'Pixel 7');
    });

    test('keeps the old label as the fallback', () async {
      final body = await uploadWith(() async => 'Android MediaProjection');
      expect(body['deviceModel'], 'Android MediaProjection');
    });

    test('without an Android plugin the default loader falls back', () async {
      late Map<String, dynamic> body;
      await http.runWithClient(() => repo().pushToLocalMcpServer(frame()), () {
        return MockClient((request) async {
          body = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response('{}', 200);
        });
      });
      expect(body['deviceModel'], 'Android MediaProjection');
    });
  });
}
