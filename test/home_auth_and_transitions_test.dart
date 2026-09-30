import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:screensync_flutter_project/blocs/screen_capture_bloc.dart';
import 'package:screensync_flutter_project/screens/home/capture_transitions.dart';
import 'package:screensync_flutter_project/screens/home/connection_toggle_button.dart';
import 'package:screensync_flutter_project/screens/onboarding/connect_step.dart';

/// Only `state` and `stream` are read by the widgets under test.
class _FakeBloc extends Fake implements ScreenCaptureBloc {
  _FakeBloc(this._state);
  final ScreenCaptureState _state;

  @override
  ScreenCaptureState get state => _state;
  @override
  Stream<ScreenCaptureState> get stream => const Stream.empty();
  @override
  Future<void> close() async {}
}

/// `/health` answers 200 even with a wrong pairing token, so "reachable" used to
/// read as "Connected" on the first screen a new user sees, while every real
/// call returned 401.
void main() {
  group('ConnectStep', () {
    Future<void> pump(WidgetTester tester, ScreenCaptureState state) async {
      await tester.binding.setSurfaceSize(const Size(393, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: BlocProvider<ScreenCaptureBloc>.value(
            value: _FakeBloc(state),
            child: ConnectStep(
              pairController: TextEditingController(),
              pairOk: false,
              onApplyPairing: () {},
              onQrPaired: () {},
              onNext: () {},
            ),
          ),
        ),
      ));
      await tester.pump(const Duration(milliseconds: 600));
    }

    testWidgets('reachable and authorised is Connected', (tester) async {
      await pump(tester, const ScreenCaptureState(hubOnline: true));

      expect(find.textContaining('Connected!'), findsOneWidget);
      expect(find.text('Continue'), findsOneWidget);
      expect(find.text('Auto-find'), findsNothing);
    });

    testWidgets('reachable but token rejected is NOT connected and says why',
        (tester) async {
      await pump(tester,
          const ScreenCaptureState(hubOnline: true, hubAuthFailed: true));

      expect(find.textContaining('Connected!'), findsNothing);
      expect(find.textContaining('rejected this pairing token'), findsOneWidget);
      expect(find.text('Continue anyway'), findsOneWidget);
      expect(find.text('Continue'), findsNothing);
      expect(find.text('Auto-find'), findsNothing,
          reason: 'discovery cannot fix a bad token');
      expect(find.text('Scan QR code'), findsOneWidget,
          reason: 're-scanning the QR is the fix');
    });

    testWidgets('an unreachable hub still offers Auto-find', (tester) async {
      await pump(tester, const ScreenCaptureState(hubOnline: false));

      expect(find.textContaining('Not connected yet'), findsOneWidget);
      expect(find.text('Auto-find'), findsOneWidget);
      expect(find.textContaining('rejected this pairing token'), findsNothing);
    });

    testWidgets('a stale auth flag on an offline hub is just "not connected"',
        (tester) async {
      await pump(tester,
          const ScreenCaptureState(hubOnline: false, hubAuthFailed: true));

      expect(find.textContaining('Not connected yet'), findsOneWidget);
      expect(find.textContaining('rejected this pairing token'), findsNothing);
    });
  });

  group('ConnectionToggleButton', () {
    Future<void> pump(
      WidgetTester tester, {
      bool connected = false,
      bool authProblem = false,
      VoidCallback? onRepair,
      VoidCallback? onConnect,
      VoidCallback? onDisconnect,
    }) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Center(
            child: ConnectionToggleButton(
              connected: connected,
              authProblem: authProblem,
              busy: false,
              onDisconnect: onDisconnect ?? () {},
              onConnect: onConnect ?? () {},
              onRepair: onRepair,
            ),
          ),
        ),
      ));
      await tester.pump(const Duration(milliseconds: 50));
    }

    testWidgets('an auth problem shows Re-pair and re-pairs on tap',
        (tester) async {
      var repairs = 0, connects = 0;
      await pump(tester,
          authProblem: true,
          onRepair: () => repairs++,
          onConnect: () => connects++);

      expect(find.text('Re-pair'), findsOneWidget);
      expect(find.text('Connect'), findsNothing);
      expect(find.text('Live'), findsNothing);

      await tester.tap(find.text('Re-pair'));
      expect(repairs, 1);
      expect(connects, 0, reason: 'Connect cannot fix a rejected token');
    });

    testWidgets('connected still reads Live and disconnects on tap',
        (tester) async {
      var disconnects = 0;
      await pump(tester, connected: true, onDisconnect: () => disconnects++);

      expect(find.text('Live'), findsOneWidget);
      await tester.tap(find.text('Live'));
      expect(disconnects, 1);
    });

    testWidgets('disconnected reads Connect and connects on tap',
        (tester) async {
      var connects = 0;
      await pump(tester, onConnect: () => connects++);

      expect(find.text('Connect'), findsOneWidget);
      await tester.tap(find.text('Connect'));
      expect(connects, 1);
    });
  });

  group('CaptureTransitions', () {
    const idle = ScreenCaptureState();
    const success = ScreenCaptureState(status: CaptureStatus.success);

    test('celebrates once when the status becomes success', () {
      final t = CaptureTransitions();

      expect(t.observe(idle), (celebrate: false, showError: false));
      expect(t.observe(success), (celebrate: true, showError: false));
      // An unrelated hub/live flip re-emits the same status: no second party.
      expect(t.observe(success), (celebrate: false, showError: false));
    });

    test('a refused mirror prompt after a success shows its message, '
        'without a celebration', () {
      final t = CaptureTransitions()..observe(success);

      final r = t.observe(const ScreenCaptureState(
          status: CaptureStatus.success,
          errorMessage: 'Screen capture was not allowed'));

      expect(r.showError, isTrue);
      expect(r.celebrate, isFalse);
    });

    test('the same message is not shown twice while it stays in the state',
        () {
      final t = CaptureTransitions();
      const failed = ScreenCaptureState(
          status: CaptureStatus.failure, errorMessage: 'boom');
      const capturing = ScreenCaptureState(
          status: CaptureStatus.capturing, errorMessage: 'boom');

      expect(t.observe(failed).showError, isTrue);
      // The next capture starts with the old message still in the state.
      expect(t.observe(capturing).showError, isFalse);
    });

    test('the same failure twice in a row is told twice', () {
      final t = CaptureTransitions();
      const failed = ScreenCaptureState(
          status: CaptureStatus.failure, errorMessage: 'boom');
      const capturing = ScreenCaptureState(status: CaptureStatus.capturing);

      expect(t.observe(failed).showError, isTrue);
      t.observe(capturing);
      expect(t.observe(failed).showError, isTrue);
    });

    test('the next capture celebrates again', () {
      final t = CaptureTransitions()..observe(success);
      t.observe(const ScreenCaptureState(status: CaptureStatus.capturing));

      expect(t.observe(success).celebrate, isTrue);
    });
  });
}
