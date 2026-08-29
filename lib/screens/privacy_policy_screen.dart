import 'package:flutter/material.dart';

import '../core/app_theme.dart';
import 'privacy_policy_content.dart';

/// First-run Privacy & Transparency page, and the read-only re-read view
/// opened from Settings.
///
/// Shown once, between the native splash and the onboarding wizard. It
/// explains — in plain language — what ScreenSync does, who it's for, every
/// Android permission it requests (and *why*), the security model, and the
/// core promise: **all data stays on the user's own devices**. No company,
/// no third party, and not even we can access it.
///
/// Follows Google Play's User Data / Permissions disclosure guidance:
/// prominent in-context disclosure, purpose for each sensitive permission,
/// and an explicit affirmative consent action before proceeding.
///
/// In [readOnly] mode (re-read from Settings) the scroll gate is bypassed
/// and the consent button becomes an always-enabled Close.
class PrivacyPolicyScreen extends StatefulWidget {
  const PrivacyPolicyScreen({super.key, this.onAccepted, this.readOnly = false});

  /// Called when the user taps “I Understand & Agree” (consent mode only).
  final VoidCallback? onAccepted;

  /// Re-read mode from Settings — no scroll gate, Close instead of consent.
  final bool readOnly;

  @override
  State<PrivacyPolicyScreen> createState() => _PrivacyPolicyScreenState();
}

class _PrivacyPolicyScreenState extends State<PrivacyPolicyScreen> {
  final _scroll = ScrollController();
  bool _reachedEnd = false;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (!_reachedEnd &&
          _scroll.position.pixels >=
              _scroll.position.maxScrollExtent - 120) {
        setState(() => _reachedEnd = true);
      }
    });
    // Short lists won't scroll — enable the CTA on next frame if so.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients &&
          _scroll.position.maxScrollExtent <= 0 &&
          !_reachedEnd) {
        setState(() => _reachedEnd = true);
      }
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  bool get _ready => widget.readOnly || _reachedEnd;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                controller: _scroll,
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
                children: [
                  const PrivacyPolicyBody(),
                  Center(
                    child: Text(
                      _ready
                          ? 'Thanks for reading. ♥'
                          : 'Scroll to the end to continue…',
                      style: AppTheme.typeCaption
                          .copyWith(color: AppTheme.darkTextDim),
                    ),
                  ),
                  const SizedBox(height: 8),
                ],
              ),
            ),

            // ── Sticky action bar ──
            Container(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
              decoration: BoxDecoration(
                color: dark ? AppTheme.darkSurface : AppTheme.lightSurface,
                border: Border(
                  top: BorderSide(
                    color: dark
                        ? AppTheme.darkBorder
                        : AppTheme.lightBorder,
                  ),
                ),
              ),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _ready
                      ? () {
                          if (widget.readOnly) {
                            Navigator.of(context).pop();
                          } else {
                            widget.onAccepted?.call();
                          }
                        }
                      : null,
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    backgroundColor: AppTheme.primary,
                    disabledBackgroundColor:
                        AppTheme.primary.withValues(alpha: 0.35),
                  ),
                  child: Text(
                    widget.readOnly ? 'Close' : 'I Understand & Agree',
                    style: const TextStyle(
                        fontWeight: FontWeight.w700, fontSize: 15),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
