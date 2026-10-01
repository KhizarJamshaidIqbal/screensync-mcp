import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import 'blocs/screen_capture_bloc.dart';
import 'core/app_navigator.dart';
import 'core/app_theme.dart';
import 'overlay_bubble.dart';
import 'repositories/screen_repository.dart';
import 'screens/home_screen.dart';
import 'screens/onboarding_screen.dart';
import 'screens/privacy_policy_screen.dart';
import 'services/capture_trigger_bridge.dart';
import 'services/device_intent_service.dart';
import 'services/diagnostics_log_service.dart';
import 'widgets/update_gate.dart';
import 'services/settings_service.dart';

@pragma('vm:entry-point')
void overlayMain() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
  ));
  runApp(
    const MaterialApp(
      debugShowCheckedModeBanner: false,
      home: OverlayBubbleWidget(),
    ),
  );
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  _installCrashHooks();
  await SettingsService.instance.init();
  _wireDiagnosticsLog();
  await CaptureTriggerBridge.configure();
  // Request POST_NOTIFICATIONS on Android 13+ so the keep-alive
  // notification is visible. Fire-and-forget — service works without it.
  DeviceIntentService.requestPostNotifications().ignore();
  runApp(const ScreenSyncApp());
}

/// Uncaught framework and async errors go to the on-device diagnostics log
/// (Telemetry > Share diagnostics), so a crash on a user's phone leaves a
/// trace. Installed first, so even a failing settings load is recorded.
void _installCrashHooks() {
  final log = DiagnosticsLogService.instance;
  FlutterError.onError = (details) {
    log.logError('flutter', details.exception, details.stack);
    FlutterError.presentError(details);
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    log.logError('platform', error, stack);
    // Returning true stops the engine's own print, so keep the error in
    // logcat (the hub's get_logcat tool reads it) in every build mode.
    debugPrint('Uncaught error: $error\n$stack');
    return true;
  };
}

/// Redacts the stored pairing tokens from every log entry and mirrors each
/// telemetry event into the log (the tab itself keeps only the last 30).
void _wireDiagnosticsLog() {
  final log = DiagnosticsLogService.instance;
  final settings = SettingsService.instance;
  log.secrets = () => [
        settings.pairingToken,
        for (final hub in settings.recentHubs) hub.token,
      ];
  settings.onTelemetryAppended = log.logTelemetry;
  DeviceIntentService.appVersion()
      .then((v) => log.log('app', 'start ${v.name} (${v.code})'))
      .ignore();
}

class ScreenSyncApp extends StatefulWidget {
  const ScreenSyncApp({super.key});

  @override
  State<ScreenSyncApp> createState() => _ScreenSyncAppState();
}

class _ScreenSyncAppState extends State<ScreenSyncApp> {
  late final ScreenCaptureBloc _bloc;

  @override
  void initState() {
    super.initState();
    _bloc = ScreenCaptureBloc(screenRepository: ScreenRepository())
      ..add(PingHubEvent());
    SettingsService.instance.addListener(_onSettingsChanged);
  }

  void _onSettingsChanged() => setState(() {/* theme/shake settings */});

  @override
  void dispose() {
    SettingsService.instance.removeListener(_onSettingsChanged);
    _bloc.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final settings = SettingsService.instance;
    return BlocProvider.value(
      value: _bloc,
      child: AnimatedBuilder(
        animation: settings,
        builder: (context, _) => MaterialApp(
          title: 'ScreenSync MCP',
          // The update gate sits above the Navigator (builder below), so it
          // reaches the Navigator through this key to show its dialog.
          navigatorKey: appNavigatorKey,
          debugShowCheckedModeBanner: false,
          themeMode: settings.themeMode,
          theme:
              AppTheme.light(accent: AppAccent.at(settings.accentColorIndex)),
          darkTheme: AppTheme.dark(
            accent: AppAccent.at(settings.accentColorIndex),
            amoled: settings.amoledDark,
          ),
          builder: (context, child) {
            // E1: clamp extreme system text scales so layouts stay intact
            // while still honoring accessibility scaling up to 1.3x.
            final mq = MediaQuery.of(context);
            final clamped = mq.copyWith(
              textScaler: mq.textScaler
                  .clamp(minScaleFactor: 0.8, maxScaleFactor: 1.3),
            );
            return MediaQuery(
              data: clamped,
              child: AppUpdateGate(child: child!),
            );
          },
          // First-run flow: splash → Privacy Policy → Onboarding → Home.
          home: !settings.privacyAccepted
              ? PrivacyPolicyScreen(
                  onAccepted: () =>
                      SettingsService.instance.privacyAccepted = true,
                )
              : settings.onboardingDone
                  ? const HomeScreen()
                  : OnboardingScreen(
                      onFinished: () =>
                          SettingsService.instance.onboardingDone = true,
                    ),
        ),
      ),
    );
  }
}
