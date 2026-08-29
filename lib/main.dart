import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import 'blocs/screen_capture_bloc.dart';
import 'core/app_theme.dart';
import 'overlay_bubble.dart';
import 'repositories/screen_repository.dart';
import 'screens/home_screen.dart';
import 'screens/onboarding_screen.dart';
import 'screens/privacy_policy_screen.dart';
import 'services/capture_trigger_bridge.dart';
import 'services/device_intent_service.dart';
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
  await SettingsService.instance.init();
  await CaptureTriggerBridge.configure();
  // Request POST_NOTIFICATIONS on Android 13+ so the keep-alive
  // notification is visible. Fire-and-forget — service works without it.
  DeviceIntentService.requestPostNotifications().ignore();
  runApp(const ScreenSyncApp());
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
            return MediaQuery(data: clamped, child: child!);
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
