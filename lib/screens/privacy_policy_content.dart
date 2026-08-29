import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../core/app_theme.dart';
import '../widgets/ref_widgets.dart';
import 'privacy_policy_widgets.dart';

/// Static scrollable body of the privacy & transparency document.
///
/// Shared by the first-run consent flow and the read-only "re-read the
/// policy" entry point in Settings. Owns no scroll state — the hosting
/// screen supplies the ListView/controller and the sticky action bar.
class PrivacyPolicyBody extends StatelessWidget {
  const PrivacyPolicyBody({super.key});

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final text = dark ? const Color(0xFFF2EEFB) : const Color(0xFF221A38);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // ── Hero ─
        Center(
          child: GlossyTile(
            icon: Icons.shield_moon_rounded,
            gradient: AppTheme.gradPrimary,
            size: 84,
            iconSize: 40,
          )
              .animate()
              .scale(
                  begin: const Offset(0.7, 0.7),
                  end: const Offset(1, 1),
                  duration: 420.ms,
                  curve: Curves.easeOutBack)
              .fadeIn(),
        ),
        const SizedBox(height: 20),
        Text.rich(
          TextSpan(children: [
            const TextSpan(text: 'Your data.\nYour '),
            TextSpan(
              text: 'devices',
              style: TextStyle(
                fontStyle: FontStyle.italic,
                color: AppTheme.accentMagenta,
              ),
            ),
            const TextSpan(text: '. Always.'),
          ]),
          textAlign: TextAlign.center,
          style: AppTheme.typeDisplay.copyWith(fontSize: 26),
        ).animate().fadeIn(delay: 80.ms),
        const SizedBox(height: 10),
        Text(
          'Privacy Policy & Transparency — please read before '
          'you continue.',
          textAlign: TextAlign.center,
          style: AppTheme.typeBody.copyWith(
              height: 1.5, color: AppTheme.darkTextDim),
        ).animate().fadeIn(delay: 140.ms),
        const SizedBox(height: 8),
        Center(
          child: Text(
            'Last updated: 29 Aug 2026',
            style: AppTheme.microLabel
                .copyWith(color: AppTheme.darkTextDim),
          ),
        ),
        const SizedBox(height: 24),

        // ── 1. What is this app ──
        PolicyCard(
          icon: Icons.auto_awesome_rounded,
          title: 'What ScreenSync Does',
          body:
              'ScreenSync is a developer & QA tool that removes the '
              'friction of getting a phone screenshot to your AI. '
              'Tap the floating bubble on your screen and the '
              'current screen is captured and delivered — over your '
              'own local network — straight to a Claude Code / '
              'Claude Desktop session through a built-in MCP '
              '(Model Context Protocol) server.\n\n'
              'No more “screenshot → WhatsApp → desktop → copy → '
              'paste into Claude”. It is one tap, end-to-end, on '
              'your own machines.',
        ),

        // ── 2. Who it's for ──
        PolicyCard(
          icon: Icons.groups_rounded,
          title: 'Who It’s Designed For',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: const [
              PolicyBullet(
                  'Developers — inspect live UI, feed screens to an '
                  'AI, and drive the device via MCP tools.'),
              PolicyBullet(
                  'Testers & QA — capture a bug the instant it '
                  'appears; the AI sees the exact screen + device '
                  'context.'),
              PolicyBullet(
                  'Designers — share real on-device layouts with an '
                  'AI for feedback, without manual file transfers.'),
            ],
          ),
        ),

        // ── 3. Why we built it ──
        PolicyCard(
          icon: Icons.flag_rounded,
          title: 'The Goal Behind It',
          body:
              'The whole point is speed and privacy at the same '
              'time. Existing flows either waste minutes moving '
              'images around, or push your screens through '
              'third-party servers. ScreenSync keeps the loop '
              'instant *and* fully on your own devices — the '
              'screenshot goes phone → your local hub → your Claude '
              'session, and nowhere else.',
        ),

        // ── 4. Permissions ──
        Padding(
          padding: const EdgeInsets.only(top: 6, bottom: 10),
          child: MicroLabel('Permissions we request — and why',
              color: text.withValues(alpha: 0.75)),
        ),
        const PermissionTile(
          icon: Icons.picture_in_picture_alt_rounded,
          name: 'Display over other apps',
          perm: 'SYSTEM_ALERT_WINDOW',
          why:
              'Draws the floating capture bubble on top of other '
              'apps so you can grab any screen with one tap. It only '
              'shows a small bubble — it never reads other apps.',
        ),
        const PermissionTile(
          icon: Icons.screenshot_monitor_rounded,
          name: 'Screen capture (MediaProjection)',
          perm:
              'FOREGROUND_SERVICE_MEDIA_PROJECTION',
          why:
              'Takes the screenshot of your current screen when you '
              'tap the bubble. Android shows its own consent dialog '
              'each session — capture cannot happen silently without '
              'your OK. Images are used only for the sync you '
              'trigger.',
        ),
        const PermissionTile(
          icon: Icons.bolt_rounded,
          name: 'Foreground service',
          perm:
              'FOREGROUND_SERVICE / SPECIAL_USE',
          why:
              'Keeps the bubble + capture pipeline alive and '
              'responsive while you work, with a persistent '
              'notification so you always know it’s running.',
        ),
        const PermissionTile(
          icon: Icons.wifi_rounded,
          name: 'Internet & network state',
          perm: 'INTERNET / ACCESS_NETWORK_STATE',
          why:
              'Sends the captured frame to your own hub on your '
              'local Wi-Fi (e.g. 192.168.x.x) and discovers it via '
              'mDNS. Used for the local link only — not to upload '
              'your data anywhere on the public internet.',
        ),
        const PermissionTile(
          icon: Icons.notifications_active_rounded,
          name: 'Notifications',
          perm: 'POST_NOTIFICATIONS',
          why:
              'Shows the keep-alive / status notification for the '
              'capture service (Android 13+). The app works even if '
              'you decline this.',
        ),
        const PermissionTile(
          icon: Icons.battery_charging_full_rounded,
          name: 'Ignore battery optimization',
          perm: 'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
          why:
              'Optional. Stops aggressive OEM battery savers from '
              'killing the bubble in the background. You choose '
              'whether to grant it.',
        ),
        const PermissionTile(
          icon: Icons.vibration_rounded,
          name: 'Vibrate',
          perm: 'VIBRATE',
          why:
              'Light haptic feedback to confirm a capture — a small '
              'buzz so you know the tap registered.',
        ),
        const PermissionTile(
          icon: Icons.photo_camera_rounded,
          name: 'Camera',
          perm: 'CAMERA',
          why:
              'Only used if you scan a QR code to pair with your '
              'desktop hub. We never take photos in the background '
              'and never access your gallery.',
        ),

        const SizedBox(height: 12),

        // ── 5. Security ──
        PolicyCard(
          icon: Icons.lock_rounded,
          title: 'Security',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: const [
              PolicyBullet(
                  'Captures travel only over your local network to '
                  'a hub you pair with — protected by a pairing '
                  'token.'),
              PolicyBullet(
                  'Each screen capture requires Android’s own '
                  'per-session MediaProjection consent — nothing is '
                  'grabbed without your explicit OK.'),
              PolicyBullet(
                  'The floating bubble shows only a bubble; it does '
                  'not read or scrape the content of other apps.'),
              PolicyBullet(
                  'You can revoke any permission at any time in '
                  'Android Settings, and stop the service from the '
                  'notification.'),
            ],
          ),
        ),

        // ── 6. Data ownership (the big promise) ──
        const HighlightCard(
          icon: Icons.verified_user_rounded,
          title: 'Your Data Stays With You',
          lines: [
            'All screenshots and device data stay on YOUR devices '
                '— your phone and your own hub/desktop.',
            'There is NO company cloud. We do not run servers that '
                'receive your screens.',
            'We — and any third party — CANNOT access your data. '
                'There is nothing for us to access.',
            'No selling, no ads, no analytics profiles built from '
                'your captures.',
          ],
        ),

        const SizedBox(height: 14),

        // ── 7. Full policy & website links ──
        PolicyCard(
          icon: Icons.link_rounded,
          title: 'Full Policy & Website',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: const [
              LinkRow(
                icon: Icons.description_rounded,
                label: 'Full Privacy Policy',
                url: 'https://screensyncmcp.epsoldev.com/privacy.html',
              ),
              SizedBox(height: 4),
              LinkRow(
                icon: Icons.public_rounded,
                label: 'EpsolDev — Official Website',
                url: 'https://epsoldev.com/',
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
      ],
    );
  }
}
