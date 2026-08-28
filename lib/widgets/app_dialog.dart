import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../core/app_theme.dart';

/// Visual accent for [AppDialog] — drives the header icon tint, the icon
/// halo, and the primary action button gradient so the dialog reads as
/// informational, destructive, or success without any extra wiring.
enum AppDialogTone { brand, danger, success }

/// A single dialog action (button). [primary] actions render as a filled,
/// gradient, stadium button; non-primary render as a soft ghost button so
/// the destructive / confirming choice always stands out.
class AppDialogAction {
  const AppDialogAction({
    required this.label,
    this.onPressed,
    this.primary = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool primary;
}

/// Brand-consistent, fully custom dialog for ScreenSync.
///
/// Replaces stock [AlertDialog] everywhere so every confirmation shares the
/// same lavender glass surface, serif title, uppercase micro-label, optional
/// header icon with a tinted halo, and one FIXED custom width ([kAppDialogWidth]).
/// Use the [AppDialog.show] helper to present it.
class AppDialog extends StatelessWidget {
  const AppDialog({
    super.key,
    required this.title,
    this.message,
    this.icon,
    this.tone = AppDialogTone.brand,
    this.eyebrow,
    this.actions = const [],
    this.content,
  });

  /// The single shared width for every dialog in the app.
  static const double kAppDialogWidth = 340.0;

  final String title;
  final String? message;
  final IconData? icon;
  final AppDialogTone tone;

  /// Optional uppercase micro-label shown above the title (e.g. "CONNECTION").
  final String? eyebrow;

  /// Optional custom body widget rendered below the message.
  final Widget? content;

  final List<AppDialogAction> actions;

  Color _accent() {
    switch (tone) {
      case AppDialogTone.danger:
        return AppTheme.danger;
      case AppDialogTone.success:
        return AppTheme.success;
      case AppDialogTone.brand:
        return AppTheme.primary;
    }
  }

  LinearGradient _accentGradient() {
    switch (tone) {
      case AppDialogTone.danger:
        return AppTheme.gradDanger;
      case AppDialogTone.success:
        return AppTheme.gradGreen;
      case AppDialogTone.brand:
        return AppTheme.gradPrimary;
    }
  }

  /// Present the dialog with the shared scrim + entrance animation.
  static Future<T?> show<T>(
    BuildContext context, {
    required String title,
    String? message,
    IconData? icon,
    AppDialogTone tone = AppDialogTone.brand,
    String? eyebrow,
    Widget? content,
    List<AppDialogAction> actions = const [],
    bool barrierDismissible = true,
  }) {
    return showGeneralDialog<T>(
      context: context,
      barrierDismissible: barrierDismissible,
      barrierLabel: title,
      barrierColor: const Color(0x66150E27),
      transitionDuration: const Duration(milliseconds: 220),
      pageBuilder: (ctx, _, __) => AppDialog(
        title: title,
        message: message,
        icon: icon,
        tone: tone,
        eyebrow: eyebrow,
        content: content,
        actions: actions,
      ),
      transitionBuilder: (ctx, anim, _, child) {
        final curved =
            CurvedAnimation(parent: anim, curve: Curves.easeOutBack);
        return FadeTransition(
          opacity: anim,
          child: ScaleTransition(
            scale: Tween<double>(begin: 0.92, end: 1.0).animate(curved),
            child: child,
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final surface = isDark ? AppTheme.darkSurface : AppTheme.lightSurface;
    final border = isDark ? AppTheme.darkBorder : AppTheme.lightBorder;
    final accent = _accent();

    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Material(
          type: MaterialType.transparency,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppTheme.radiusL),
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
              child: Container(
                width: kAppDialogWidth,
                padding: const EdgeInsets.fromLTRB(22, 24, 22, 18),
                decoration: BoxDecoration(
                  color: surface.withValues(alpha: isDark ? 0.94 : 0.96),
                  borderRadius: BorderRadius.circular(AppTheme.radiusL),
                  border: Border.all(color: border),
                  boxShadow: AppTheme.elevHigh,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (icon != null) ...[
                      _IconHalo(icon: icon!, accent: accent),
                      const SizedBox(height: 16),
                    ],
                    if (eyebrow != null) ...[
                      Text(
                        eyebrow!.toUpperCase(),
                        style: AppTheme.microLabel.copyWith(color: accent),
                      ),
                      const SizedBox(height: 6),
                    ],
                    Text(
                      title,
                      style: AppTheme.typeDisplay.copyWith(
                        fontSize: 22,
                        color: theme.textTheme.titleLarge?.color,
                      ),
                    ),
                    if (message != null) ...[
                      const SizedBox(height: 10),
                      Text(
                        message!,
                        style: AppTheme.typeBody.copyWith(
                          fontSize: 13.5,
                          height: 1.45,
                          color: AppTheme.darkTextDim,
                        ),
                      ),
                    ],
                    if (content != null) ...[
                      const SizedBox(height: 14),
                      content!,
                    ],
                    const SizedBox(height: 22),
                    _ActionRow(
                      actions: actions,
                      accent: accent,
                      gradient: _accentGradient(),
                      isDark: isDark,
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

/// Tinted circular halo behind the header icon.
class _IconHalo extends StatelessWidget {
  const _IconHalo({required this.icon, required this.accent});
  final IconData icon;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 52,
      height: 52,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            accent.withValues(alpha: 0.24),
            accent.withValues(alpha: 0.10),
          ],
        ),
        border: Border.all(color: accent.withValues(alpha: 0.4)),
        boxShadow: [
          BoxShadow(
            color: accent.withValues(alpha: 0.28),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Icon(icon, color: accent, size: 24),
    )
        .animate()
        .scaleXY(begin: 0.6, end: 1.0, duration: 320.ms, curve: Curves.easeOutBack)
        .fadeIn(duration: 220.ms);
  }
}

/// Right-aligned action row: ghost buttons + one gradient primary button.
class _ActionRow extends StatelessWidget {
  const _ActionRow({
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
    final children = <Widget>[];
    for (var i = 0; i < actions.length; i++) {
      final a = actions[i];
      if (i > 0) children.add(const SizedBox(width: 10));
      children.add(
        a.primary
            ? _PrimaryButton(action: a, gradient: gradient, accent: accent)
            : _GhostButton(action: a, isDark: isDark),
      );
    }
    return Row(mainAxisAlignment: MainAxisAlignment.end, children: children);
  }
}

class _PrimaryButton extends StatelessWidget {
  const _PrimaryButton(
      {required this.action, required this.gradient, required this.accent});
  final AppDialogAction action;
  final LinearGradient gradient;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: action.onPressed,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          decoration: BoxDecoration(
            gradient: gradient,
            borderRadius: BorderRadius.circular(999),
            boxShadow: [
              BoxShadow(
                color: accent.withValues(alpha: 0.4),
                blurRadius: 12,
                offset: const Offset(0, 5),
              ),
            ],
          ),
          child: Text(
            action.label,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w700,
              fontSize: 13.5,
              letterSpacing: 0.2,
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
    final base = isDark ? AppTheme.darkTextDim : AppTheme.darkTextDim;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: action.onPressed,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: (isDark ? AppTheme.darkBorder : AppTheme.lightBorder),
            ),
          ),
          child: Text(
            action.label,
            style: TextStyle(
              color: base,
              fontWeight: FontWeight.w700,
              fontSize: 13.5,
              letterSpacing: 0.2,
            ),
          ),
        ),
      ),
    );
  }
}
