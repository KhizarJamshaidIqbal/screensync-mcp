import 'package:flutter/material.dart';

import '../../widgets/app_dialog.dart';

/// "Share diagnostics" on the Telemetry tab. Says what the file holds, then
/// hands it to the Android share sheet: nothing leaves the phone until the user
/// picks an app there.
class ShareDiagnosticsButton extends StatelessWidget {
  const ShareDiagnosticsButton({super.key, required this.onShare});

  /// Writes the report and opens the share sheet; false when that failed.
  final Future<bool> Function() onShare;

  Future<void> _confirmAndShare(BuildContext context) async {
    final go = await AppDialog.show<bool>(
      context,
      eyebrow: 'Diagnostics',
      title: 'Share diagnostics?',
      message: 'A text file with the app version, the phone model, the hub '
          'host, the last 30 telemetry events and the recent app log. The '
          'pairing token is never included. Nothing is sent until you pick '
          'an app.',
      icon: Icons.ios_share_rounded,
      actions: [
        AppDialogAction(
          label: 'Cancel',
          onPressed: () => Navigator.pop(context, false),
        ),
        AppDialogAction(
          label: 'Share',
          primary: true,
          icon: Icons.ios_share_rounded,
          onPressed: () => Navigator.pop(context, true),
        ),
      ],
    );
    if (go != true || !context.mounted) return;
    if (await onShare() || !context.mounted) return;
    await AppDialog.show<void>(
      context,
      eyebrow: 'Diagnostics',
      title: 'Could not share',
      message: 'The diagnostics file could not be written, or no app could '
          'receive it. Try again, or install a mail or files app.',
      icon: Icons.error_outline_rounded,
      tone: AppDialogTone.danger,
      actions: [
        AppDialogAction(
          label: 'OK',
          primary: true,
          onPressed: () => Navigator.pop(context),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton.icon(
        onPressed: () => _confirmAndShare(context),
        icon: const Icon(Icons.ios_share_rounded, size: 18),
        label: const Text('Share diagnostics'),
      ),
    );
  }
}
