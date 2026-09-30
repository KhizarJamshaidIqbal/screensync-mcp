import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:screensync_flutter_project/repositories/screen_repository.dart';
import 'package:screensync_flutter_project/services/settings_service.dart';

/// Disconnect used to store an empty token. `getString(...) ?? default` only
/// covers null, so the empty string came back as-is and every later call went
/// out as `Authorization: Bearer ` (401) while the unauthenticated /health kept
/// the UI saying CONNECTED.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<SettingsService> settingsWith(Map<String, Object> stored) async {
    SharedPreferences.setMockInitialValues(stored);
    await SettingsService.instance.init();
    return SettingsService.instance;
  }

  group('SettingsService.pairingToken', () {
    test('defaults when nothing is stored', () async {
      final s = await settingsWith({});
      expect(s.pairingToken, SettingsService.defaultPairingToken);
    });

    test('an empty stored token falls back to the default', () async {
      final s = await settingsWith({'pairing_token': ''});
      expect(s.pairingToken, 'screensync-local-dev');
    });

    test('a whitespace-only stored token falls back to the default', () async {
      final s = await settingsWith({'pairing_token': '   '});
      expect(s.pairingToken, 'screensync-local-dev');
    });

    test('a real token round-trips, trimmed', () async {
      final s = await settingsWith({});
      s.pairingToken = '  abc123  ';
      expect(s.pairingToken, 'abc123');
    });

    test('assigning a blank token removes the key instead of storing ""',
        () async {
      final s = await settingsWith({'pairing_token': 'abc123'});
      s.pairingToken = '';
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.containsKey('pairing_token'), isFalse);
      expect(s.pairingToken, 'screensync-local-dev');
    });

    test('clearPairingToken (Disconnect) removes the key', () async {
      final s = await settingsWith({'pairing_token': 'abc123'});
      s.clearPairingToken();
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.containsKey('pairing_token'), isFalse);
      expect(s.pairingToken, 'screensync-local-dev');
    });
  });

  group('ScreenRepository auth header', () {
    Future<Map<String, String>> headerSentWith(String? Function() resolver) async {
      late Map<String, String> sent;
      final repo = ScreenRepository()
        ..hubUrlResolver = (() => 'http://hub.test:3000')
        ..tokenResolver = (() => resolver() ?? '');
      await http.runWithClient(() => repo.checkHubAuth(), () {
        return MockClient((request) async {
          sent = request.headers;
          return http.Response(jsonEncode({'success': true}), 200);
        });
      });
      return sent;
    }

    test('an empty resolved token is replaced, never sent as "Bearer "',
        () async {
      final headers = await headerSentWith(() => '');
      expect(headers['Authorization'], 'Bearer screensync-local-dev');
    });

    test('a blank resolved token is replaced too', () async {
      final headers = await headerSentWith(() => '   ');
      expect(headers['Authorization'], 'Bearer screensync-local-dev');
    });

    test('a real token is sent as-is', () async {
      final headers = await headerSentWith(() => 'tok-42');
      expect(headers['Authorization'], 'Bearer tok-42');
    });
  });
}
