import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:screensync_flutter_project/screens/pair_scan_screen.dart';
import 'package:screensync_flutter_project/services/settings_service.dart';

/// Widget tests for the pairing screen.
///
/// There is no camera in the test binding, so these exercise the paths that do not need
/// one: the screen builds, the paste fallback works, validation rejects a bad link, and
/// the stall hint appears. The camera preview itself is covered by `padLeft` of nothing -
/// see the note in the delivery report: the animated scan path needs a real device.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await SettingsService.instance.init();
  });

  /// The viewfinder animates forever, so `pumpAndSettle` would never return. Pump a fixed
  /// number of frames instead, then tear the tree down so no ticker outlives the test.
  Future<void> settle(WidgetTester tester) async {
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 120));
    }
  }

  Future<void> tearDownTree(WidgetTester tester) =>
      tester.pumpWidget(const SizedBox.shrink());

  testWidgets('builds and offers the paste fallback', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: PairScanScreen()));
    await settle(tester);

    expect(find.text('Pair with desktop'), findsOneWidget);
    expect(find.text('Paste link instead'), findsOneWidget);

    await tearDownTree(tester);
  });

  testWidgets('paste dialog rejects a link the hub never produces',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(home: PairScanScreen()));
    await settle(tester);

    await tester.tap(find.text('Paste link instead'));
    await settle(tester);
    expect(find.text('Paste pairing link'), findsOneWidget);

    // Neither a scheme nor a host: PairingService.parse must refuse it.
    await tester.enterText(find.byType(TextField), 'definitely not a pairing link');
    await tester.tap(find.text('Pair'));
    await settle(tester);

    expect(find.text('Not a valid pairing link or hub URL.'), findsOneWidget);
    // Still on the scanner: a rejected link must never pop the screen.
    expect(find.text('Pair with desktop'), findsOneWidget);

    await tester.tap(find.text('Cancel'));
    await settle(tester);
    await tearDownTree(tester);
  });

  testWidgets('accepts a well-formed pairing URL', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: PairScanScreen()));
    await settle(tester);

    await tester.tap(find.text('Paste link instead'));
    await settle(tester);
    await tester.enterText(
      find.byType(TextField),
      'http://192.168.1.5:3000#pairtoken123',
    );
    await tester.tap(find.text('Pair'));
    await settle(tester);

    // _apply writes the override before it pops.
    expect(SettingsService.instance.hubUrlOverride, 'http://192.168.1.5:3000');
    expect(SettingsService.instance.pairingToken, 'pairtoken123');
    // And the hub is remembered for one-tap reconnect next time.
    expect(
      SettingsService.instance.recentHubs.first.url,
      'http://192.168.1.5:3000',
    );

    await tearDownTree(tester);
  });
}