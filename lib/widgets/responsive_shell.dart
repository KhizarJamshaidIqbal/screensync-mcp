import 'package:flutter/material.dart';

/// One primary destination of the app shell.
class ShellDestination {
  const ShellDestination({
    required this.icon,
    required this.selectedIcon,
    required this.label,
    required this.body,
  });

  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final Widget body;
}

/// A2: adaptive navigation scaffold.
///  - <600dp  → Material 3 bottom [NavigationBar]
///  - ≥600dp  → [NavigationRail]
///  - ≥900dp  → rail + two-pane (body + persistent side panel)
/// Bodies live in an [IndexedStack] so scroll positions and state survive
/// tab switches. Pure layout: takes destinations so it stays widget-testable
/// without the full BLoC stack.
class ResponsiveShell extends StatelessWidget {
  const ResponsiveShell({
    super.key,
    required this.destinations,
    required this.selectedIndex,
    required this.onSelect,
    this.appBar,
    this.sidePanel,
    this.overlay,
  });

  final List<ShellDestination> destinations;
  final int selectedIndex;
  final ValueChanged<int> onSelect;
  final PreferredSizeWidget? appBar;

  /// Shown as the second pane on ≥900dp layouts.
  final Widget? sidePanel;

  /// Optional stacked overlay (e.g. capture celebration card).
  final Widget? overlay;

  static const double railBreakpoint = 600;
  static const double twoPaneBreakpoint = 900;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final useRail = width >= railBreakpoint;
        final twoPane = width >= twoPaneBreakpoint && sidePanel != null;

        final stack = Stack(
          children: [
            IndexedStack(
              index: selectedIndex,
              children: [for (final d in destinations) d.body],
            ),
            if (overlay != null) overlay!,
          ],
        );

        if (!useRail) {
          return Scaffold(
            appBar: appBar,
            body: stack,
            bottomNavigationBar: NavigationBar(
              selectedIndex: selectedIndex,
              onDestinationSelected: onSelect,
              labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
              destinations: [
                for (final d in destinations)
                  NavigationDestination(
                    icon: Icon(d.icon),
                    selectedIcon: Icon(d.selectedIcon),
                    label: d.label,
                    tooltip: d.label,
                  ),
              ],
            ),
          );
        }

        return Scaffold(
          appBar: appBar,
          body: Row(
            children: [
              SafeArea(
                child: NavigationRail(
                  selectedIndex: selectedIndex,
                  onDestinationSelected: onSelect,
                  labelType: NavigationRailLabelType.all,
                  destinations: [
                    for (final d in destinations)
                      NavigationRailDestination(
                        icon: Icon(d.icon),
                        selectedIcon: Icon(d.selectedIcon),
                        label: Text(d.label),
                      ),
                  ],
                ),
              ),
              const VerticalDivider(width: 1, thickness: 1),
              Expanded(flex: 3, child: stack),
              if (twoPane) ...[
                const VerticalDivider(width: 1, thickness: 1),
                Expanded(flex: 2, child: sidePanel!),
              ],
            ],
          ),
        );
      },
    );
  }
}
