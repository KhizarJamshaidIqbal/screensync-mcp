import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../core/app_theme.dart';
import '../../repositories/screen_repository.dart';
import '../../services/settings_service.dart';
import '../../widgets/ref_widgets.dart';

/// The `screensync://pair` deep link for [hubUrl] + [token], as scanned by
/// another phone (or pasted into the link field).
String pairingLinkFor(String hubUrl, String token) =>
    'screensync://pair?url=${Uri.encodeComponent(hubUrl)}'
    '&token=${Uri.encodeComponent(token)}';

/// The hub URL and token this phone is really using.
///
/// Resolved like every hub call in the app: manual override, then the hub found
/// over mDNS, then the build default ([ScreenRepository.hubUrl]) - with the token
/// the app sends. [repo] is the running app's repository (the one that knows the
/// discovered hub); without it (a bare widget test) only the saved settings and
/// the build defaults apply. Reading just the manual override and falling back to
/// 127.0.0.1 made the "my code" QR useless on a phone paired via discovery.
({String url, String token}) currentPairing({
  ScreenRepository? repo,
  required SettingsService settings,
}) {
  final source = repo ??
      (ScreenRepository()
        ..hubUrlResolver = (() => settings.hubUrlOverride)
        ..tokenResolver = (() => settings.pairingToken));
  return (url: source.hubUrl, token: source.pairingToken);
}

/// Bottom sheet that shows [link] as a QR code with a copy button.
Future<void> showMyPairingCodeSheet(
  BuildContext context, {
  required String link,
}) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: AppTheme.darkSurface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.radiusL)),
    ),
    builder: (sheetContext) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Text('Your current pairing code',
                style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            const Text(
              'Scan this from another device to pair it with the same hub.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: AppTheme.darkTextDim),
            ),
            const SizedBox(height: 14),
            DecoratedBox(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(AppTheme.radiusM),
              ),
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: QrImageView(data: link, size: 190),
              ),
            ),
            const SizedBox(height: 12),
            TextButton.icon(
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: link));
                if (sheetContext.mounted) Navigator.of(sheetContext).pop();
              },
              icon: const Icon(Icons.copy_rounded),
              label: const Text('Copy link'),
            ),
          ],
        ),
      ),
    ),
  );
}

class PairStatusLine extends StatelessWidget {
  const PairStatusLine({super.key, required this.found, required this.reading});

  final bool found;
  final bool reading;

  @override
  Widget build(BuildContext context) {
    final label = found
        ? 'Code found — pairing…'
        : reading
            ? 'Looking for a code…'
            : 'Point at the QR shown by the desktop hub';
    return Text(
      label,
      style: TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: found ? AppTheme.success : Colors.white,
        shadows: const <Shadow>[Shadow(blurRadius: 8)],
      ),
    );
  }
}

class PairHintChip extends StatelessWidget {
  const PairHintChip({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: AppTheme.warning.withValues(alpha: 0.18),
        borderRadius: BorderRadius.circular(AppTheme.radiusS),
        border: Border.all(color: AppTheme.warning.withValues(alpha: 0.5)),
      ),
      child: Text(
        text,
        style: const TextStyle(fontSize: 11.5, color: AppTheme.warning),
      ),
    );
  }
}

class PairRecentHubs extends StatelessWidget {
  const PairRecentHubs({super.key, required this.hubs, required this.onPick});

  final List<({String url, String token})> hubs;
  final void Function(({String url, String token}) hub) onPick;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 34,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: hubs.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final hub = hubs[i];
          final host = Uri.tryParse(hub.url)?.host ?? hub.url;
          return ActionChip(
            avatar: const Icon(Icons.history_rounded, size: 16),
            label: Text(host, style: const TextStyle(fontSize: 11.5)),
            onPressed: () => onPick(hub),
          );
        },
      ),
    );
  }
}

class PairScanAction extends StatelessWidget {
  const PairScanAction({
    super.key,
    required this.tooltip,
    required this.icon,
    required this.onPressed,
  });

  final String tooltip;
  final IconData icon;
  final Future<void> Function()? onPressed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6),
      child: Tooltip(
        message: tooltip,
        child: IconButton.filledTonal(
          onPressed: onPressed == null ? null : () => onPressed!(),
          icon: AnimatedSwitcher(
            duration: AppTheme.motionFast,
            transitionBuilder: (child, animation) => ScaleTransition(
              scale: animation,
              child: RotationTransition(turns: animation, child: child),
            ),
            child: Icon(icon, key: ValueKey<IconData>(icon)),
          ),
          style: IconButton.styleFrom(
            backgroundColor: AppTheme.primary.withValues(alpha: 0.2),
            foregroundColor: AppTheme.secondary,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppTheme.radiusM),
            ),
          ),
        ),
      ),
    );
  }
}

class PairCameraFailure extends StatelessWidget {
  const PairCameraFailure({
    super.key,
    required this.message,
    required this.onOpenSettings,
    required this.onPaste,
  });

  final String message;
  final Future<void> Function() onOpenSettings;
  final VoidCallback onPaste;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: AppTheme.darkSurface,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Icon(Icons.videocam_off_rounded,
                  size: 48, color: AppTheme.warning),
              const SizedBox(height: 12),
              const Text(
                'Camera unavailable on this device.',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 6),
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12, color: AppTheme.darkTextDim),
              ),
              const SizedBox(height: 18),
              GradientActionButton(
                icon: Icons.content_paste_rounded,
                label: 'Paste link instead',
                onTap: onPaste,
              ),
              const SizedBox(height: 6),
              TextButton.icon(
                onPressed: () => onOpenSettings(),
                icon: const Icon(Icons.settings_rounded, size: 18),
                label: const Text('Open settings'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
