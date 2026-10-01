import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:screensync_flutter_project/blocs/hub_maintenance_mixin.dart';
import 'package:screensync_flutter_project/blocs/live_mirror_mixin.dart';
import 'package:screensync_flutter_project/blocs/screen_capture_event.dart';
import 'package:screensync_flutter_project/blocs/screen_capture_state.dart';
import 'package:screensync_flutter_project/models/capture_quality.dart';
import 'package:screensync_flutter_project/models/captured_frame.dart';
import 'package:screensync_flutter_project/repositories/screen_repository.dart';
import 'package:screensync_flutter_project/services/connection_metrics_service.dart';
import 'package:screensync_flutter_project/services/settings_service.dart';
import 'package:screensync_flutter_project/services/capture_pipeline_service.dart';

/// `MediaProjectionService` talks to two native channels. This stands in for the
/// Kotlin side so tests can decide what the OS answers.
class FakeProjectionNative {
  static const method = MethodChannel('com.screensync.mcp/media_projection');

  /// What `isCaptureReady` returns.
  bool ready = false;

  /// What `prepareCapture` does: return true (and go ready), return false, or
  /// throw a [PlatformException] carrying this code.
  bool grant = true;
  String? failWithCode;

  /// What `isPaused` returns (the Capture controls switch).
  bool paused = false;

  int prepareCalls = 0;
  int captureCalls = 0;
  int stopCalls = 0;

  void install() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(method, (call) async {
      switch (call.method) {
        case 'isCaptureReady':
          return ready;
        case 'isPaused':
          return paused;
        case 'prepareCapture':
          prepareCalls++;
          if (failWithCode != null) {
            throw PlatformException(code: failWithCode!, message: failWithCode);
          }
          if (grant) ready = true;
          return grant;
        case 'captureScreen':
          captureCalls++;
          return Uint8List.fromList(<int>[1, 2, 3]);
        case 'stopCapture':
          stopCalls++;
          ready = false;
          return null;
        default:
          return null;
      }
    });
  }

  void uninstall() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(method, null);
  }
}

/// A hub repository whose network and capture calls are scripted.
class FakeScreenRepository extends ScreenRepository {
  FakeScreenRepository({this.url = 'http://192.168.1.10:3000'});

  final String url;

  /// Result of every push; false makes the mirror count failures.
  bool pushOk = true;
  int pushes = 0;
  int captures = 0;
  final capturePrompts = <bool>[];

  /// Scripted hub health/auth answers (used by the hub-maintenance tests).
  bool pingOk = true;
  HubAuthStatus authStatus = HubAuthStatus.ok;
  int pings = 0;
  int authChecks = 0;

  @override
  String get hubUrl => url;

  @override
  Future<({bool ok, int ms})> pingHubTimed(
      {Duration timeout = const Duration(seconds: 2)}) async {
    pings++;
    return (ok: pingOk, ms: pingOk ? 12 : 0);
  }

  @override
  Future<bool> pingHub({Duration timeout = const Duration(seconds: 2)}) async =>
      pingOk;

  @override
  Future<HubAuthStatus> checkHubAuth(
      {Duration timeout = const Duration(seconds: 3)}) async {
    authChecks++;
    return authStatus;
  }

  @override
  Future<CapturedFrame> captureCurrentDisplay({
    CaptureQuality quality = CaptureQuality.inspection,
    NormRect? crop,
    bool allowPrompt = true,
  }) async {
    captures++;
    capturePrompts.add(allowPrompt);
    return CapturedFrame(
        imageBytes: Uint8List.fromList(<int>[1, 2, 3]), mimeType: 'image/jpeg');
  }

  @override
  Future<bool> pushToLocalMcpServer(CapturedFrame frame) async {
    pushes++;
    return pushOk;
  }
}

/// Smallest bloc that hosts [LiveMirrorMixin], so the mirror logic can be
/// driven without the full app bloc (its constructor starts overlay, SSE,
/// discovery and sqflite work that has no place in a unit test).
class MirrorTestBloc extends Bloc<ScreenCaptureEvent, ScreenCaptureState>
    with LiveMirrorMixin {
  MirrorTestBloc(
    this.repo, {
    ScreenCaptureState? initial,
    bool registerNow = true,
  }) : super(initial ??
            const ScreenCaptureState(
                hubOnline: true, hubUrl: 'http://192.168.1.10:3000')) {
    // In the app this handler lives in LiveHubEventsMixin.
    on<FrameSeenEvent>((event, emit) =>
        emit(state.copyWith(lastFrameAt: event.at, framesFresh: true)));
    // In the app this handler lives in ScreenCaptureBloc itself.
    on<OverlayBubbleToggledExternally>(
        (event, emit) => emit(state.copyWith(isOverlayRunning: event.running)));
    if (registerNow) registerLiveMirror();
  }

  final FakeScreenRepository repo;
  final projection = StreamController<bool>.broadcast();
  final telemetry = <String>[];
  final _metrics = ConnectionMetricsService();

  @override
  ScreenRepository get hubRepo => repo;
  @override
  SettingsService get hubSettings => SettingsService.instance;
  @override
  ConnectionMetricsService get metrics => _metrics;
  @override
  Stream<bool> get projectionStateStream => projection.stream;

  @override
  void recordTelemetry({
    required String kind,
    required String label,
    required int durationMs,
    required bool ok,
  }) =>
      telemetry.add(label);

  @override
  Future<void> close() {
    disposeLiveMirror();
    projection.close();
    return super.close();
  }
}

/// Lets queued bloc events and mock-channel replies run to completion.
Future<void> settleBloc() => pumpEventQueue(times: 60);

/// Smallest bloc that hosts [HubMaintenanceMixin] (hub health, auth verdict,
/// Disconnect) without the app bloc's overlay/SSE/sqflite side effects.
class HubTestBloc extends Bloc<ScreenCaptureEvent, ScreenCaptureState>
    with HubMaintenanceMixin {
  HubTestBloc(this.repo, {ScreenCaptureState? initial})
      : super(initial ?? const ScreenCaptureState()) {
    // The real handler lives in the app bloc's sync mixin.
    on<SyncPendingEvent>((event, emit) => syncRequests++);
    registerHubMaintenance();
  }

  final FakeScreenRepository repo;
  int syncRequests = 0;
  final discoveryTelemetry = <String>[];

  @override
  ScreenRepository get hubRepo => repo;
  @override
  SettingsService get hubSettings => SettingsService.instance;

  @override
  void recordDiscoveryTelemetry({
    required String kind,
    required String label,
    required int durationMs,
    required bool ok,
  }) =>
      discoveryTelemetry.add(label);

  @override
  Future<void> close() {
    disposeHubMaintenance();
    return super.close();
  }
}
