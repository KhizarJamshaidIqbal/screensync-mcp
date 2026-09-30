import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:screensync_flutter_project/screens/settings/os_control_tile.dart';

/// The tile used to resolve the hub from the manual override or a build-time
/// 127.0.0.1 default, ignoring the mDNS-discovered hub, so on a phone that found
/// its hub by discovery it asked the phone itself and said "hub unreachable".
/// It now talks to exactly the URL and token its parent hands it (the
/// repository's resolved values).
void main() {
  final requests = <http.Request>[];

  MockClient hub({int status = 200, Map<String, Object?>? body}) {
    return MockClient((request) async {
      requests.add(request);
      return http.Response(
          jsonEncode(body ?? {'success': true, 'enabled': true, 'source': 'app'}),
          status);
    });
  }

  Future<void> pump(WidgetTester tester, Widget tile) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: tile)));
    await tester.pump();
    await tester.pump();
  }

  setUp(requests.clear);

  testWidgets('asks the hub it was given, with the token it was given',
      (tester) async {
    await pump(
        tester,
        OsControlTile(
            hubUrl: 'http://192.168.1.50:3000',
            token: 'tok-9',
            client: hub()));

    expect(requests, hasLength(1));
    expect(requests.single.url.toString(),
        'http://192.168.1.50:3000/api/os-control');
    expect(requests.single.headers['Authorization'], 'Bearer tok-9');
    expect(tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
        isTrue);
    expect(find.textContaining('hub unreachable'), findsNothing);
  });

  testWidgets('a trailing slash on the hub URL does not double up',
      (tester) async {
    await pump(
        tester,
        OsControlTile(
            hubUrl: 'http://192.168.1.50:3000/', token: 't', client: hub()));

    expect(requests.single.url.toString(),
        'http://192.168.1.50:3000/api/os-control');
  });

  testWidgets('reloads when the hub URL changes (e.g. mDNS finds the hub)',
      (tester) async {
    final client = hub();
    await pump(tester,
        OsControlTile(hubUrl: 'http://127.0.0.1:3000', token: 't', client: client));
    expect(requests.last.url.host, '127.0.0.1');

    await pump(
        tester,
        OsControlTile(
            hubUrl: 'http://192.168.1.50:3000', token: 't', client: client));

    expect(requests, hasLength(2));
    expect(requests.last.url.host, '192.168.1.50');
  });

  testWidgets('reloads when the hub comes back online', (tester) async {
    final client = hub();
    await pump(
        tester,
        OsControlTile(
            hubUrl: 'http://h:3000', token: 't', hubOnline: false, client: client));
    await pump(
        tester,
        OsControlTile(
            hubUrl: 'http://h:3000', token: 't', hubOnline: true, client: client));

    expect(requests, hasLength(2));
  });

  testWidgets('does not reload for an unrelated rebuild', (tester) async {
    final client = hub();
    for (var i = 0; i < 3; i++) {
      await pump(tester,
          OsControlTile(hubUrl: 'http://h:3000', token: 't', client: client));
    }
    expect(requests, hasLength(1));
  });

  testWidgets('an unreachable hub says so and leaves the switch alone',
      (tester) async {
    await pump(
        tester,
        OsControlTile(
          hubUrl: 'http://h:3000',
          token: 't',
          client: MockClient((_) async => throw http.ClientException('down')),
        ));

    expect(find.textContaining('hub unreachable'), findsOneWidget);
    expect(tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
        isFalse);
  });

  testWidgets('a rejected token is reported as the hub\'s answer',
      (tester) async {
    await pump(
        tester,
        OsControlTile(
            hubUrl: 'http://h:3000',
            token: 'wrong',
            client: hub(status: 401, body: {'success': false})));

    expect(find.textContaining('hub said 401'), findsOneWidget);
  });

  group('toggling with a rejected token', () {
    MockClient hubRejectingPost({required bool enabled}) =>
        MockClient((request) async {
          requests.add(request);
          return request.method == 'POST'
              ? http.Response(jsonEncode({'success': false}), 401)
              : http.Response(
                  jsonEncode({'enabled': enabled, 'source': 'app'}), 200);
        });

    testWidgets('turning it off keeps the switch on and shows the 401',
        (tester) async {
      await pump(
          tester,
          OsControlTile(
              hubUrl: 'http://h:3000',
              token: 'wrong',
              client: hubRejectingPost(enabled: true)));
      expect(tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
          isTrue);

      await tester.tap(find.byType(SwitchListTile));
      await tester.pump();
      await tester.pump();

      expect(find.textContaining('hub said 401'), findsOneWidget);
      expect(tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
          isTrue,
          reason: 'the failed write must not flip the switch');
    });

    testWidgets('turning it on keeps the switch off and shows the 401',
        (tester) async {
      await pump(
          tester,
          OsControlTile(
              hubUrl: 'http://h:3000',
              token: 'wrong',
              client: hubRejectingPost(enabled: false)));

      await tester.tap(find.byType(SwitchListTile));
      await tester.pump();
      await tester.pump();

      expect(find.textContaining('hub said 401'), findsOneWidget);
      expect(tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
          isFalse);
    });
  });
}
