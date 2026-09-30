import 'package:flutter/material.dart';

import '../core/app_theme.dart';

/// A single dialog action (button). [primary] actions render as a filled,
/// gradient, stadium button; non-primary render as a soft ghost button so
/// the destructive / confirming choice always stands out.
///
/// A null [onPressed] renders the button disabled. [busy] shows a spinner in
/// place of [icon] and also disables the button (an action is in flight).
class AppDialogAction {
  const AppDialogAction({
    required this.label,
    this.onPressed,
    this.primary = false,
    this.icon,
    this.busy = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool primary;
  final IconData? icon;
  final bool busy;

  bool get enabled => onPressed != null && !busy;
}

/// Right-aligned action row: ghost buttons + one gradient primary button.
class AppDialogActionRow extends StatelessWidget {
  const AppDialogActionRow({
    super.key,
    required this.actions,
    required this.accent,
    required this.gradient,
    required this.isDark,
  });

  final List<AppDialogAction> actions;
  final Color accent;
  final LinearGradient gradient;
  final bool isDark;

  @override
  Widget build(BuildContext context) {
    // A Wrap, not a Row: on a narrow phone two buttons that do not fit side by
    // side drop to their own line instead of overflowing.
    return Wrap(
      alignment: WrapAlignment.end,
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 10,
      runSpacing: 10,
      children: [
        for (final a in actions)
          a.primary
              ? _PrimaryButton(action: a, gradient: gradient, accent: accent)
              : _GhostButton(action: a, isDark: isDark),
      ],
    );
  }
}

/// Fades a disabled action with the shared motion token so the change from
/// "ready" to "working" reads as a state change, not a flicker.
class _ActionFade extends StatelessWidget {
  const _ActionFade({required this.enabled, required this.child});
  final bool enabled;
  final Widget child;

  @override
  Widget build(BuildContext context) => AnimatedOpacity(
        opacity: enabled ? 1 : 0.55,
        duration: AppTheme.motionFast,
        curve: AppTheme.motionStandard,
        child: child,
      );
}

class _PrimaryButton extends StatelessWidget {
  const _PrimaryButton(
      {required this.action, required this.gradient, required this.accent});
  final AppDialogAction action;
  final LinearGradient gradient;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    const labelStyle = TextStyle(
      color: Colors.white,
      fontWeight: FontWeight.w700,
      fontSize: 13.5,
      letterSpacing: 0.2,
    );
    return Semantics(
      button: true,
      enabled: action.enabled,
      label: action.label,
      onTap: action.enabled ? action.onPressed : null,
      excludeSemantics: true,
      child: _ActionFade(
        enabled: action.enabled || action.busy,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(999),
            onTap: action.enabled ? action.onPressed : null,
            child: Container(
              // 48dp is the minimum comfortable touch target.
              constraints: const BoxConstraints(minHeight: 48),
              padding: const EdgeInsets.symmetric(horizontal: 20),
              decoration: BoxDecoration(
                gradient: gradient,
                borderRadius: BorderRadius.circular(999),
                boxShadow: action.enabled
                    ? [
                        BoxShadow(
                          color: accent.withValues(alpha: 0.4),
                          blurRadius: 12,
                          offset: const Offset(0, 5),
                        ),
                      ]
                    : null,
              ),
              child: Center(
                widthFactor: 1,
                child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (action.busy) ...[
                    const SizedBox(
                      width: 15,
                      height: 15,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(width: 9),
                  ] else if (action.icon != null) ...[
                    Icon(action.icon, size: 18, color: Colors.white),
                    const SizedBox(width: 8),
                  ],
                  Flexible(
                    child: Text(
                      action.label,
                      overflow: TextOverflow.ellipsis,
                      style: labelStyle,
                    ),
                  ),
                ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _GhostButton extends StatelessWidget {
  const _GhostButton({required this.action, required this.isDark});
  final AppDialogAction action;
  final bool isDark;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      enabled: action.enabled,
      label: action.label,
      onTap: action.enabled ? action.onPressed : null,
      excludeSemantics: true,
      child: _ActionFade(
        enabled: action.enabled,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(999),
            onTap: action.enabled ? action.onPressed : null,
            child: Container(
              constraints: const BoxConstraints(minHeight: 48),
              padding: const EdgeInsets.symmetric(horizontal: 18),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(999),
                border: Border.all(
                  color: isDark ? AppTheme.darkBorder : AppTheme.lightBorder,
                ),
              ),
              child: Center(
                widthFactor: 1,
                child: Text(
                  action.label,
                  style: const TextStyle(
                    color: AppTheme.darkTextDim,
                    fontWeight: FontWeight.w700,
                    fontSize: 13.5,
                    letterSpacing: 0.2,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
