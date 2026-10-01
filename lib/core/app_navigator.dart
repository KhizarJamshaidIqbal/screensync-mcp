import 'package:flutter/widgets.dart';

/// The one [Navigator] of the main app, shared by [MaterialApp.navigatorKey].
///
/// Anything that sits ABOVE the navigator in the widget tree - notably the
/// update gate, which lives in `MaterialApp.builder` - has no Navigator
/// ancestor, so `showDialog(context: context)` from there throws. Such code
/// shows its routes through `appNavigatorKey.currentContext` instead.
final GlobalKey<NavigatorState> appNavigatorKey =
    GlobalKey<NavigatorState>(debugLabel: 'appNavigator');
