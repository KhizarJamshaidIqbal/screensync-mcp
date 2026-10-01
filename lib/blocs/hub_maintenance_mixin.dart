import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../repositories/screen_repository.dart';
import '../services/hub_discovery_service.dart';
import '../services/settings_service.dart';
import 'screen_capture_event.dart';
import 'screen_capture_state.dart';

/// Internal event used by the maintenance timer to publish hub status from
/// outside an event handler (emit is only valid inside handlers).
class HubStatusEvent extends ScreenCaptureEvent {
  final bool ok;
  final int? ms;
  final List<DiscoveredHub>? hubs;

  /// The hub answered but refused an authenticated call (wrong pairing token).
  final bool authFailed;
  const HubStatusEvent(
      {required this.ok, this.ms, this.hubs, this.authFailed = false});
  @override
  List<Object?> get props => [ok, ms, hubs, authFailed];
}

/// Zero-config hub lifecycle: periodic health checks, auto-sync of pending
/// frames, and mDNS + LAN-scan auto-discovery with reconnect.
mixin HubMaintenanceMixin on Bloc<ScreenCaptureEvent, ScreenCaptureState> {
  ScreenRepository get hubRepo;
  SettingsService get hubSettings;
  void recordDiscoveryTelemetry({
    required String kind,
    required String label,
    required int durationMs,
    required bool ok,
  });

  Timer? _hubMaintenance;
  bool _scanning = false;

  void registerHubMaintenance() {
    on<PingHubEvent>(_onPingHub);
    on<DiscoverHubsEvent>(_onDiscoverHubs);
    on<AutoConnectHubEvent>(_onAutoConnectHub);
    on<SelectHubEvent>(_onSelectHub);
    on<SetHubUrlEvent>(_onSetHubUrl);
    on<DisconnectHubEvent>(_onDisconnectHub);
    on<SetPairingTokenEvent>(_onSetPairingToken);
    on<HubStatusEvent>((event, emit) {
      emit(state.copyWith(
        hubOnline: event.ok,
        hubLatencyMs: event.ok ? event.ms : null,
        hubUrl: hubRepo.hubUrl,
        hubSource: hubRepo.hubSource,
        discoveredHubs: event.hubs ?? state.discoveredHubs,
        hubAuthFailed: event.ok && event.authFailed,
      ));
    });
    _ensureMaintenance();
  }

  /// Starts the 20 s maintenance timer when it is not already running.
  ///
  /// Regression guard: [_onDisconnectHub] cancels the timer and the only other
  /// entry point, [registerHubMaintenance], runs once from the bloc
  /// constructor. A single Disconnect - or a connect flow that never reached
  /// [registerHubMaintenance] again - therefore killed auto-sync for the rest
  /// of the process lifetime while the 5 s latency sampler kept the connection
  /// badge green. Captured frames piled up unsynced and were never pushed to
  /// the hub, so the phone looked "Connected" while delivering nothing.
  /// Every connect/select/ping path re-arms through here, so the timer can no
  /// longer be lost.
  void _ensureMaintenance() {
    if (_hubMaintenance != null) return;
    _hubMaintenance =
        Timer.periodic(const Duration(seconds: 20), (_) => maintainHub());
  }

  void disposeHubMaintenance() {
    _hubMaintenance?.cancel();
    _hubMaintenance = null;
  }

  // Every tick: refresh hub status first so the badge and latency stay honest
  // even while the hub reports "online" (previously the tick returned early and
  // a hub that went away was never noticed), then push pending frames when
  // auto-sync is on, then fall back to discovery when the hub is unreachable.
  @visibleForTesting
  Future<void> maintainHub() async {
    // Use the ping result itself: add(HubStatusEvent) is only queued here, so
    // state.hubOnline would still hold the previous tick's value.
    final online = await _refreshHubStatus();
    if (online) {
      if (hubSettings.autoSync && state.unsyncedCount > 0) {
        add(SyncPendingEvent());
      }
      return;
    }
    if (hubSettings.autoDiscover) await autoDiscoverHub();
  }

  Future<bool> _refreshHubStatus() async {
    final res = await hubRepo.pingHubTimed();
    add(HubStatusEvent(
        ok: res.ok, ms: res.ms, authFailed: await _authRejected(res.ok)));
    return res.ok;
  }

  /// `/health` is unauthenticated, so a reachable hub can still be refusing
  /// this phone's token. One bearer-guarded call tells the two apart.
  Future<bool> _authRejected(bool reachable) async =>
      reachable && await hubRepo.checkHubAuth() == HubAuthStatus.rejected;

  Future<bool> autoDiscoverHub() async {
    if (_scanning) return false;
    _scanning = true;
    try {
      // A saved emulator-only override (127.0.0.1 / 10.0.2.2) would win the
      // resolution chain and block auto-discovery on a real phone — drop it.
      _clearEmulatorOnlyOverride();
      // Hard timeout: Bonsoir's ready-future can hang forever on some
      // devices, which would strand _scanning=true and block every retry.
      var hubs = const <DiscoveredHub>[];
      try {
        hubs = await HubDiscoveryService()
            .discover(timeout: const Duration(seconds: 3))
            .timeout(const Duration(seconds: 5), onTimeout: () => const []);
      } catch (_) {/* fall through to LAN scan */}
      final viaMdns = hubs.isNotEmpty;
      if (hubs.isEmpty) {
        // Routers that drop Wi-Fi multicast kill mDNS browse — probe the
        // phone's own /24 for the hub's /health endpoint instead.
        try {
          final scanned = await HubDiscoveryService()
              .scanSubnet()
              .timeout(const Duration(seconds: 10), onTimeout: () => null);
          if (scanned != null) hubs = [scanned];
        } catch (_) {/* scan unavailable */}
      }
      recordDiscoveryTelemetry(
        kind: 'discovery',
        label: viaMdns ? 'hub via mDNS' : 'hub via LAN scan',
        durationMs: 0,
        ok: hubs.isNotEmpty,
      );
      if (hubs.isEmpty) return false;
      hubRepo.setAutoHubUrl(hubs.first.url);
      final res = await hubRepo.pingHubTimed();
      add(HubStatusEvent(
          ok: res.ok,
          ms: res.ms,
          hubs: hubs,
          authFailed: await _authRejected(res.ok)));
      return res.ok;
    } catch (_) {
      return false;
    } finally {
      _scanning = false;
    }
  }

  void _clearEmulatorOnlyOverride() {
    final o = hubSettings.hubUrlOverride;
    if (o.isEmpty) return;
    if (o.contains('127.0.0.1') ||
        o.contains('localhost') ||
        o.contains('10.0.2.2')) {
      hubSettings.hubUrlOverride = '';
    }
  }

  Future<void> _onPingHub(
      PingHubEvent event, Emitter<ScreenCaptureState> emit) async {
    // Any ping means the app is in an active connect flow: make sure the
    // maintenance/auto-sync timer is alive again (it may have been cancelled by
    // a previous Disconnect).
    _ensureMaintenance();
    final res = await hubRepo.pingHubTimed();
    final authFailed = await _authRejected(res.ok);
    emit(state.copyWith(
      hubOnline: res.ok,
      hubLatencyMs: res.ok ? res.ms : null,
      hubUrl: hubRepo.hubUrl,
      hubSource: hubRepo.hubSource,
      hubAuthFailed: authFailed,
    ));
    if (!res.ok && hubSettings.autoDiscover) await autoDiscoverHub();
  }

  Future<void> _onDiscoverHubs(
      DiscoverHubsEvent event, Emitter<ScreenCaptureState> emit) async {
    emit(state.copyWith(discovering: true, discoveredHubs: const []));
    final hubs = await HubDiscoveryService().discover();
    emit(state.copyWith(discovering: false, discoveredHubs: hubs));
  }

  Future<void> _onAutoConnectHub(AutoConnectHubEvent event,
      Emitter<ScreenCaptureState> emit) async {
    _ensureMaintenance();
    emit(state.copyWith(discovering: true, errorMessage: null));
    final ok = await autoDiscoverHub();
    emit(state.copyWith(discovering: false));
    if (!ok) {
      emit(state.copyWith(
        errorMessage:
            'No ScreenSync hub found (mDNS + LAN scan). Start the desktop '
            'hub: start-hub.bat / start-hub.sh from screensyncmcp.epsoldev.com',
      ));
    }
  }

  Future<void> _onSelectHub(
      SelectHubEvent event, Emitter<ScreenCaptureState> emit) async {
    hubSettings.hubUrlOverride = event.hub.url;
    emit(state.copyWith(hubUrl: event.hub.url, hubOnline: null));
    add(PingHubEvent());
  }

  Future<void> _onSetHubUrl(
      SetHubUrlEvent event, Emitter<ScreenCaptureState> emit) async {
    hubSettings.hubUrlOverride = event.url;
    emit(state.copyWith(hubUrl: event.url, hubOnline: null));
    add(PingHubEvent());
  }

  /// Fully closes the ScreenSync MCP server connection. Unlike a transient
  /// ping failure, this is an explicit user action: we clear the persisted
  /// hub URL + token so the app does not silently auto-reconnect, drop the
  /// live SSE bridge, and stop the maintenance timer until the user connects
  /// again.
  Future<void> _onDisconnectHub(
      DisconnectHubEvent event, Emitter<ScreenCaptureState> emit) async {
    _hubMaintenance?.cancel();
    _hubMaintenance = null;
    hubSettings.hubUrlOverride = '';
    // Remove the key rather than storing '': an empty token used to be read
    // back as-is and every later call went out as "Bearer " (401) while the
    // unauthenticated /health still made the UI say CONNECTED.
    hubSettings.clearPairingToken();
    emit(state.copyWith(
      hubUrl: '',
      hubOnline: false,
      hubLatencyMs: null,
      liveConnected: false,
      discovering: false,
      hubAuthFailed: false,
    ));
  }

  void _onSetPairingToken(
      SetPairingTokenEvent event, Emitter<ScreenCaptureState> emit) {
    hubSettings.pairingToken = event.token;
    // A new token changes the auth verdict: re-check now instead of waiting
    // for the next maintenance tick.
    add(PingHubEvent());
  }
}
