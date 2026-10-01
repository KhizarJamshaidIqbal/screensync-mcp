import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:screensync_flutter_project/repositories/screen_repository.dart';
import 'package:screensync_flutter_project/screens/pair_scan/pair_scan_parts.dart';
import 'package:screensync_flutter_project/services/pairing_service.dart';
import 'package:screensync_flutter_project/services/settings_service.dart';

/// "My pairing code" on the scan screen used to read only the manual override
/// and fall back to 127.0.0.1, so a phone that found its hub over mDNS handed
/// out a code pointing at itself.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await SettingsService.instance.init();
  });

  ScreenRepository appRepo() => ScreenRepository()
    ..hubUrlResolver = (() => SettingsService.instance.hubUrlOverride)
    ..tokenResolver = (() => SettingsService.instance.pairingToken);

  test('uses the mDNS-discovered hub when there is no manual override', () {
    final repo = appRepo()..setAutoHubUrl('http://192.168.1.77:3000');

    final pairing =
        currentPairing(repo: repo, settings: SettingsService.instance);

    expect(pairing.url, 'http://192.168.1.77:3000');
    expect(pairing.url, isNot(contains('127.0.0.1')));
  });

  test('a manual override still wins over discovery', () {
    SettingsService.instance.hubUrlOverride = 'http://10.0.0.5:3000';
    final repo = appRepo()..setAutoHubUrl('http://192.168.1.77:3000');

    expect(currentPairing(repo: repo, settings: SettingsService.instance).url,
        'http://10.0.0.5:3000');
  });

  test('carries the token the app actually sends', () {
    SettingsService.instance.pairingToken = 'tok-42';
    final pairing =
        currentPairing(repo: appRepo(), settings: SettingsService.instance);
    expect(pairing.token, 'tok-42');
  });

  test('never yields an empty token', () {
    final pairing =
        currentPairing(repo: appRepo(), settings: SettingsService.instance);
    expect(pairing.token, 'screensync-local-dev');
  });

  test('without the app repository it falls back to settings', () {
    SettingsService.instance.hubUrlOverride = 'http://10.0.0.5:3000';
    SettingsService.instance.pairingToken = 'tok-42';

    final pairing = currentPairing(settings: SettingsService.instance);

    expect(pairing.url, 'http://10.0.0.5:3000');
    expect(pairing.token, 'tok-42');
  });

  test('the generated link parses back to the same hub and token', () {
    final link = pairingLinkFor('http://192.168.1.77:3000', 'tok 42/=');
    final parsed = PairingService.parse(link);

    expect(parsed, isNotNull);
    expect(parsed!.url, 'http://192.168.1.77:3000');
    expect(parsed.token, 'tok 42/=');
  });

  // The MCP tab's QR code used to carry the whole Connect Kit (about 11 KB) and
  // threw QrInputTooLongException on every build. The pairing link it shows now
  // has to stay far inside the largest QR code at level M: 2,331 bytes.
  test('the pairing link fits in a QR code with room to spare', () {
    final link = pairingLinkFor('http://192.168.100.200:3000', 'x' * 128);
    expect(utf8.encode(link).length, lessThan(2331 ~/ 4));
  });
}
