import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/app_theme.dart';

/// Standard section card — title + body text or custom child.
class PolicyCard extends StatelessWidget {
  const PolicyCard({
    super.key,
    required this.icon,
    required this.title,
    this.body,
    this.child,
  });

  final IconData icon;
  final String title;
  final String? body;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final text = dark ? const Color(0xFFF2EEFB) : const Color(0xFF221A38);
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: GlassPanel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    gradient: AppTheme.gradPrimary,
                    borderRadius: BorderRadius.circular(AppTheme.radiusS),
                  ),
                  child: Icon(icon, color: Colors.white, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(title,
                      style: AppTheme.typeTitleLarge.copyWith(color: text)),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (body != null)
              Text(body!,
                  style: AppTheme.typeBody
                      .copyWith(height: 1.55, color: text.withValues(alpha: 0.9))),
            if (child != null) child!,
          ],
        ),
      ),
    );
  }
}

/// Per-permission row: icon + friendly name + tech name + why.
class PermissionTile extends StatelessWidget {
  const PermissionTile({
    super.key,
    required this.icon,
    required this.name,
    required this.perm,
    required this.why,
  });

  final IconData icon;
  final String name;
  final String perm;
  final String why;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final text = dark ? const Color(0xFFF2EEFB) : const Color(0xFF221A38);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: GlassPanel(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: AppTheme.primary.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(AppTheme.radiusS),
              ),
              child: Icon(icon, color: AppTheme.primary, size: 18),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name,
                      style:
                          AppTheme.typeTitleMedium.copyWith(color: text)),
                  const SizedBox(height: 2),
                  Text(perm,
                      style: AppTheme.microLabel
                          .copyWith(color: AppTheme.darkTextDim)),
                  const SizedBox(height: 6),
                  Text(why,
                      style: AppTheme.typeBodyMedium.copyWith(
                          height: 1.5,
                          color: text.withValues(alpha: 0.85))),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Emphasised “your data stays with you” card with a green trust accent.
class HighlightCard extends StatelessWidget {
  const HighlightCard({
    super.key,
    required this.icon,
    required this.title,
    required this.lines,
  });

  final IconData icon;
  final String title;
  final List<String> lines;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: AppTheme.gradGreen,
        borderRadius: BorderRadius.circular(AppTheme.radiusL),
        boxShadow: AppTheme.elevMid,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: Colors.white, size: 24),
              const SizedBox(width: 10),
              Expanded(
                child: Text(title,
                    style: AppTheme.typeTitleLarge
                        .copyWith(color: Colors.white)),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ...lines.map(
            (l) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 2),
                    child: Icon(Icons.check_circle_rounded,
                        color: Colors.white, size: 16),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(l,
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.95),
                          fontSize: 12.5,
                          height: 1.5,
                          fontWeight: FontWeight.w500,
                        )),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Simple bulleted line used inside policy cards.
class PolicyBullet extends StatelessWidget {
  const PolicyBullet(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final t = dark ? const Color(0xFFF2EEFB) : const Color(0xFF221A38);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            margin: const EdgeInsets.only(top: 6, right: 10),
            width: 6,
            height: 6,
            decoration: const BoxDecoration(
              color: AppTheme.primary,
              shape: BoxShape.circle,
            ),
          ),
          Expanded(
            child: Text(text,
                style: AppTheme.typeBodyMedium.copyWith(
                    height: 1.5, color: t.withValues(alpha: 0.88))),
          ),
        ],
      ),
    );
  }
}

/// Tappable link row that opens an external URL in the browser.
class LinkRow extends StatelessWidget {
  const LinkRow({
    super.key,
    required this.icon,
    required this.label,
    required this.url,
  });

  final IconData icon;
  final String label;
  final String url;

  Future<void> _open() async {
    final uri = Uri.parse(url);
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: _open,
      borderRadius: BorderRadius.circular(AppTheme.radiusS),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: AppTheme.primary.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(AppTheme.radiusS),
              ),
              child: Icon(icon, color: AppTheme.primary, size: 18),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label,
                      style: AppTheme.typeTitleMedium
                          .copyWith(color: AppTheme.primary)),
                  const SizedBox(height: 2),
                  Text(url,
                      style: AppTheme.microLabel
                          .copyWith(color: AppTheme.darkTextDim)),
                ],
              ),
            ),
            const Icon(Icons.open_in_new_rounded,
                color: AppTheme.primary, size: 16),
          ],
        ),
      ),
    );
  }
}
