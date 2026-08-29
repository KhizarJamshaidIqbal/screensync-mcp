import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

/// E2: motion-reduce support. Honors `MediaQuery.disableAnimations`
/// (OS "remove animations" accessibility setting).
bool reduceMotion(BuildContext context) =>
    MediaQuery.maybeDisableAnimationsOf(context) ?? false;

/// Entrance effect that becomes a no-op when the user disabled animations.
extension MotionSafeAnimate on Widget {
  Widget entrance(BuildContext context, {Duration delay = Duration.zero}) {
    if (reduceMotion(context)) return this;
    return animate(delay: delay).fadeIn(duration: 380.ms).slideY(
        begin: 0.05, end: 0, duration: 380.ms, curve: Curves.easeOutCubic);
  }
}
