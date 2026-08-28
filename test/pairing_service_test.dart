import 'package:flutter_test/flutter_test.dart';

import 'package:screensync_flutter_project/services/pairing_service.dart';

void main() {
  group('PairingService.parse', () {
    test('parses screensync:// deep link', () {
      final p = PairingService.parse(
          'screensync://pair?url=http%3A%2F%2F192.168.1.2%3A3000&token=abc123');
      expect(p, isNotNull);
      expect(p!.url, 'http://192.168.1.2:3000');
      expect(p.token, 'abc123');
    });

    test('parses JSON payload', () {
      final p = PairingService.parse(
          '{"url":"http://10.0.0.5:3000","token":"tok"}');
      expect(p, isNotNull);
      expect(p!.url, 'http://10.0.0.5:3000');
      expect(p.token, 'tok');
    });

    test('parses plain URL with fragment token', () {
      final p = PairingService.parse('http://192.168.1.9:3000#mytoken');
      expect(p, isNotNull);
      expect(p!.url, 'http://192.168.1.9:3000');
      expect(p.token, 'mytoken');
    });

    test('plain URL without token falls back to default token', () {
      final p = PairingService.parse('http://192.168.1.9:3000');
      expect(p, isNotNull);
      expect(p!.token, 'screensync-local-dev');
    });

    test('strips trailing slash', () {
      final p = PairingService.parse(
          'screensync://pair?url=${Uri.encodeComponent("http://192.168.1.2:3000/")}&token=t');
      expect(p!.url, 'http://192.168.1.2:3000');
    });

    test('rejects garbage', () {
      expect(PairingService.parse('hello world'), isNull);
      expect(PairingService.parse(''), isNull);
      expect(PairingService.parse('{"nope":true}'), isNull);
      expect(PairingService.parse('ftp://192.168.1.1'), isNull);
      expect(PairingService.parse('screensync://pair?token=only'), isNull);
    });

    test('empty token in deep link falls back to default', () {
      final p = PairingService.parse(
          'screensync://pair?url=${Uri.encodeComponent("http://1.2.3.4:3000")}&token=');
      expect(p, isNotNull);
      expect(p!.token, 'screensync-local-dev');
    });
  });
}
