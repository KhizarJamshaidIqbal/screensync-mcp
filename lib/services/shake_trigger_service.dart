import 'dart:async';
import 'dart:math' as math;

import 'package:sensors_plus/sensors_plus.dart';

/// Emits one event per qualifying shake gesture, with a cooldown between
/// events so a single shake cannot spam captures.
Stream<void> shakeGestures({
  double threshold = 14.0,
  Duration cooldown = const Duration(seconds: 3),
}) {
  DateTime lastFire = DateTime.fromMillisecondsSinceEpoch(0);
  return userAccelerometerEventStream()
      .map((event) => event.magnitude())
      .transform(
    StreamTransformer<double, void>.fromHandlers(handleData: (magnitude, sink) {
      final now = DateTime.now();
      if (magnitude >= threshold && now.difference(lastFire) > cooldown) {
        lastFire = now;
        sink.add(null);
      }
    }),
  );
}

extension on UserAccelerometerEvent {
  double magnitude() => math.sqrt(x * x + y * y + z * z);
}
