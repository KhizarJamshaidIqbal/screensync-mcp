import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:screensync_flutter_project/blocs/screen_capture_event.dart';
import 'package:screensync_flutter_project/blocs/screen_capture_state.dart';
import 'package:screensync_flutter_project/repositories/screen_repository.dart';
import 'package:screensync_flutter_project/services/settings_service.dart';

import 'support/mirror_test_kit.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late FakeScreenRepository repo;
  late HubTestBloc bloc;

  Future<HubTestBloc> makeBloc({ScreenCaptureState? initial}) async {
    final b = HubTestBloc(repo, initial: initial);
    addTearDown(b.close);
    return b;
  }

  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await SettingsService.instance.init();
    repo = FakeScreenRepository();
  });

  group('maintenance tick', () {
    test(
        'a healthy hub syncs pending frames on the FIRST tick, it does not '
        'fall into discovery because hubOnline was still stale', () async {
      // Before the first status event lands, state.hubOnline is still null. The
      // old code read that stale value right after add(HubStatusEvent) and took
      // the "hub offline" branch (auto-discovery) even though the ping had
      // just succeeded.
      bloc = await makeBloc(initial: const ScreenCaptureState(unsyncedCount: 3));
      expect(bloc.state.hubOnline, isNull);

      await bloc.maintainHub();
      await settleBloc();

      expect(bloc.syncRequests, 1);
      expect(bloc.discoveryTelemetry, isEmpty,
          reason: 'no discovery pass for a reachable hub');
      expect(bloc.state.hubOnline, isTrue);
    });

    test('nothing pending means nothing to sync', () async {
      bloc = await makeBloc();
      await bloc.maintainHub();
      await settleBloc();
      expect(bloc.syncRequests, 0);
    });

    test('auto-sync off never pushes on its own', () async {
      SettingsService.instance.autoSync = false;
      bloc = await makeBloc(initial: const ScreenCaptureState(unsyncedCount: 2));
      await bloc.maintainHub();
      await settleBloc();
      expect(bloc.syncRequests, 0);
    });
  });

  group('authenticated hub check', () {
    test('a reachable hub that rejects the token is an auth problem, not '
        '"connected"', () async {
      repo.authStatus = HubAuthStatus.rejected;
      bloc = await makeBloc();

      await bloc.maintainHub();
      await settleBloc();

      expect(bloc.state.hubOnline, isTrue, reason: '/health still answers');
      expect(bloc.state.hubAuthFailed, isTrue);
    });

    test('clears once the token is accepted again', () async {
      repo.authStatus = HubAuthStatus.rejected;
      bloc = await makeBloc();
      await bloc.maintainHub();
      await settleBloc();
      expect(bloc.state.hubAuthFailed, isTrue);

      repo.authStatus = HubAuthStatus.ok;
      await bloc.maintainHub();
      await settleBloc();
      expect(bloc.state.hubAuthFailed, isFalse);
    });

    test('an inconclusive check (timeout, 5xx) is not reported as an auth '
        'problem', () async {
      repo.authStatus = HubAuthStatus.unknown;
      bloc = await makeBloc();
      await bloc.maintainHub();
      await settleBloc();
      expect(bloc.state.hubAuthFailed, isFalse);
    });

    test('an offline hub is not asked for auth and is not an auth problem',
        () async {
      repo.pingOk = false;
      SettingsService.instance.autoDiscover = false;
      bloc = await makeBloc();

      await bloc.maintainHub();
      await settleBloc();

      expect(repo.authChecks, 0);
      expect(bloc.state.hubOnline, isFalse);
      expect(bloc.state.hubAuthFailed, isFalse);
    });

    test('saving a new token re-checks right away', () async {
      bloc = await makeBloc();
      final before = repo.pings;

      bloc.add(const SetPairingTokenEvent('fresh-token'));
      await settleBloc();

      expect(SettingsService.instance.pairingToken, 'fresh-token');
      expect(repo.pings, greaterThan(before));
      expect(repo.authChecks, greaterThan(0));
    });
  });

  group('Disconnect', () {
    test('removes the token instead of storing an empty string', () async {
      SettingsService.instance.pairingToken = 'abc123';
      SettingsService.instance.hubUrlOverride = 'http://192.168.1.10:3000';
      bloc = await makeBloc(
          initial: const ScreenCaptureState(
              hubOnline: true, hubUrl: 'http://192.168.1.10:3000'));

      bloc.add(DisconnectHubEvent());
      await settleBloc();

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.containsKey('pairing_token'), isFalse,
          reason: 'an empty stored token used to 401 every later call');
      expect(SettingsService.instance.pairingToken, 'screensync-local-dev');
      expect(SettingsService.instance.hubUrlOverride, isEmpty);
      expect(bloc.state.hubUrl, isEmpty);
      expect(bloc.state.hubOnline, isFalse);
      expect(bloc.state.hubAuthFailed, isFalse);
    });
  });
}
