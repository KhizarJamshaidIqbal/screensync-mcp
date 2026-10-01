import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../core/app_theme.dart';
import 'app_dialog_actions.dart';

// Callers build actions through the dialog, so one import is enough.
export 'app_dialog_actions.dart' show AppDialogAction;

/// Visual accent for [AppDialog] — drives the header icon tint, the icon
/// halo, and the primary action button gradient so the dialog reads as
/// informational, destructive, or success without any extra wiring.
enum AppDialogTone { brand, danger, success }

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
    this.pinned,
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

  /// Optional widget pinned between the scrolling body and the buttons (a
  /// progress bar, a result banner). Unlike [content] it never scrolls off a
  /// short screen, so the user always sees what the action they just took did.
  final Widget? pinned;

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
    return showCustom<T>(
      context,
      barrierLabel: title,
      barrierDismissible: barrierDismissible,
      builder: (_) => AppDialog(
        title: title,
        message: message,
        icon: icon,
        tone: tone,
        eyebrow: eyebrow,
        content: content,
        actions: actions,
      ),
    );
  }

  /// Present a dialog whose state lives in its own widget (progress, a form,
  /// a result that arrives later) with the SAME scrim and entrance animation
  /// as [show]. [builder] returns an [AppDialog], usually from inside a
  /// StatefulWidget, so the dialog can rebuild itself.
  ///
  /// This is the only way to show a stateful dialog: do not reach for
  /// `showDialog` + `AlertDialog` (test/theme_guardrails_test.dart fails on it).
  static Future<T?> showCustom<T>(
    BuildContext context, {
    required WidgetBuilder builder,
    String barrierLabel = 'Dialog',
    bool barrierDismissible = true,
  }) {
    return showGeneralDialog<T>(
      context: context,
      barrierDismissible: barrierDismissible,
      barrierLabel: barrierLabel,
      barrierColor: const Color(0x66150E27),
      transitionDuration: const Duration(milliseconds: 220),
      pageBuilder: (ctx, _, __) => builder(ctx),
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
    // From the theme, not the constants, so AMOLED mode (whose surface is
    // near-black) and any accent override reach the dialog like every stock
    // Material widget.
    final surface = theme.colorScheme.surface;
    final border = theme.dividerColor;
    final accent = _accent();

    // A dialog is its own route: name it for screen readers, and lift it above
    // the keyboard (showGeneralDialog, unlike showDialog, does not do that).
    return Semantics(
      scopesRoute: true,
      namesRoute: true,
      explicitChildNodes: true,
      label: title,
      child: AnimatedPadding(
        padding: MediaQuery.viewInsetsOf(context),
        duration: AppTheme.motionFast,
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 24),
            child: Material(
              type: MaterialType.transparency,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(AppTheme.radiusL),
                child: BackdropFilter(
                  filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
                  child: Container(
                    width: kAppDialogWidth,
                    decoration: BoxDecoration(
                      color: surface.withValues(alpha: isDark ? 0.94 : 0.96),
                      borderRadius: BorderRadius.circular(AppTheme.radiusL),
                      border: Border.all(color: border),
                      boxShadow: AppTheme.elevHigh,
                    ),
                    // The body scrolls and the buttons stay pinned, so a long
                    // message, a large text scale or a short (landscape) screen
                    // never overflows and the actions are always reachable. The
                    // padding sits INSIDE the scroll view so the halo glow and
                    // the pills' shadows are not clipped flat at its edge.
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Flexible(
                          flex: 3,
                          child: SingleChildScrollView(
                            padding: const EdgeInsets.fromLTRB(22, 24, 22, 0),
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
                                    style: AppTheme.microLabel
                                        .copyWith(color: accent),
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
                              ],
                            ),
                          ),
                        ),
                        // Body and pinned slot share a short screen (3 : 2), each
                        // scrolling inside its own share, so neither can push the
                        // buttons off the bottom however tall it gets.
                        if (pinned != null)
                          Flexible(
                            flex: 2,
                            child: SingleChildScrollView(
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 22),
                              child: pinned!,
                            ),
                          ),
                        const SizedBox(height: 22),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(22, 0, 22, 18),
                          child: AppDialogActionRow(
                            actions: actions,
                            accent: accent,
                            gradient: _accentGradient(),
                            isDark: isDark,
                          ),
                        ),
                      ],
                    ),
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
