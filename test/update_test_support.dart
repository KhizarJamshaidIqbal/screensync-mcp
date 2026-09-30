import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Mocks the native "com.screensync.mcp/device" channel for the update tests
/// and records what the Dart side asked of it.
class FakeDevice {
  static const channel = MethodChannel('com.screensync.mcp/device');

  final calls = <String>[];
  final installedPaths = <String>[];

  /// [installApk] is what the native `installApk` answers with (a
  /// [PlatformException] is thrown, anything else returned as is).
  void mock({
    String? installer,
    Object? installApk = 'started',
    Object? startPlay = 'installed',
    Map<String, Object?>? version,
  }) {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      calls.add(call.method);
      switch (call.method) {
        case 'installerPackage':
          return installer;
        case 'versionInfo':
          return version ??
              <String, Object?>{'versionName': '2.5.4', 'versionCode': 32};
        case 'installApk':
          installedPaths.add((call.arguments as Map)['path'] as String);
          if (installApk is PlatformException) throw installApk;
          return installApk;
        case 'startPlayUpdate':
          return startPlay;
      }
      return null;
    });
  }

  /// No handler at all: every call throws MissingPluginException.
  void unmock() => TestDefaultBinaryMessengerBinding
      .instance.defaultBinaryMessenger
      .setMockMethodCallHandler(channel, null);

  void reset() {
    calls.clear();
    installedPaths.clear();
  }
}
