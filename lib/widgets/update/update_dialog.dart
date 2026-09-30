import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../../core/app_theme.dart';
import '../../models/update_progress.dart';
import '../../services/app_update_service.dart';
import '../app_dialog.dart';
import '../app_progress_bar.dart';

/// What the update dialog was closed with.
enum UpdateDialogResult { later }

/// How a result line from the update service should look.
enum UpdateStatusKind { success, attention, info, problem }

/// The branded update dialog, built on [AppDialog]: gradient icon halo, serif
/// title, "this build -> new build" row, size and checksum chips, a live
/// progress bar while the APK downloads, and a tinted banner for the outcome.
///
/// Owns its own working / progress / status state, so the install keeps
/// reporting even though the dialog lives in the Navigator's overlay and not
/// inside the gate's subtree. Show it with [AppDialog.showCustom].
class UpdateDialog extends StatefulWidget {
  const UpdateDialog({
    super.key,
    required this.info,
    required this.service,
    required this.token,
    required this.refresh,
  });

  final AppUpdateInfo info;
  final AppUpdateService service;
  final String Function() token;

  /// Re-reads the published manifest (see `AppUpdateGate`): the hub may have
  /// rebuilt the APK while the dialog was open.
  final Future<AppUpdateInfo?> Function() refresh;

  /// Sorts the one-line result the service returns into a look. The service
  /// speaks in sentences for the user, so this matches on their opening words.
  static UpdateStatusKind classify(String line) {
    final l = line.toLowerCase();
    if (l.startsWith('installer opened') || l.startsWith('installed')) {
      return UpdateStatusKind.success;
    }
    if (l.contains('install unknown apps')) return UpdateStatusKind.attention;
    if (l.startsWith('no update') ||
        l.startsWith('update cancelled') ||
        l.contains('has no update')) {
      return UpdateStatusKind.info;
    }
    return UpdateStatusKind.problem;
  }

  @override
  State<UpdateDialog> createState() => _UpdateDialogState();
}

class _UpdateDialogState extends State<UpdateDialog> {
  bool _working = false;
  String? _status;
  UpdateProgress? _progress;
  int _shownPercent = -1;

  /// The manifest this dialog acts on: [UpdateDialog.info] until a tap on
  /// "Update now" re-reads it and finds the hub republished.
  late AppUpdateInfo _info = widget.info;

  Future<void> _act() async {
    setState(() {
      _working = true;
      _status = null;
      _progress = null;
      _shownPercent = -1;
    });
    if (!_info.playManaged) {
      final fresh = await _refreshed();
      if (!mounted) return;
      if (fresh != null && !fresh.updateAvailable) {
        setState(() {
          _working = false;
          _status = 'No update is available any more.';
        });
        return;
      }
      if (fresh != null) setState(() => _info = fresh);
    }
    String line;
    try {
      line = await widget.service.install(
        _info,
        token: widget.token(),
        onProgress: _onProgress,
      );
    } catch (_) {
      line = 'The update could not be started. Try again.';
    }
    if (!mounted) return;
    setState(() {
      _working = false;
      _progress = null;
      _status = line;
    });
  }

  /// A download reports once per chunk; rebuild only when the visible whole
  /// percent (or the phase) changes, so a 90 MB APK costs ~100 rebuilds.
  void _onProgress(UpdateProgress p) {
    if (!mounted) return;
    final percent = p.percent ?? -1;
    if (_progress?.phase == p.phase && percent == _shownPercent) return;
    _shownPercent = percent;
    setState(() => _progress = p);
  }

  /// Null when the hub cannot be reached: the download then reports the real
  /// problem against the info the dialog already has.
  Future<AppUpdateInfo?> _refreshed() async {
    try {
      return await widget.refresh();
    } catch (_) {
      return null;
    }
  }

  Future<void> _later() async {
    await widget.service.dismiss(_info.versionCode);
    if (mounted) Navigator.of(context).pop(UpdateDialogResult.later);
  }

  String get _workLabel {
    if (_info.playManaged) return 'Opening Play...';
    return switch (_progress?.phase) {
      UpdatePhase.downloading => 'Downloading...',
      UpdatePhase.verifying => 'Verifying...',
      UpdatePhase.opening => 'Opening...',
      null => 'Starting...',
    };
  }

  String get _caption {
    final p = _progress;
    if (_info.playManaged) return 'Opening Google Play...';
    if (p == null) return 'Getting ready...';
    switch (p.phase) {
      case UpdatePhase.downloading:
        final pct = p.percent;
        if (pct == null) return 'Downloading...';
        return 'Downloading - $pct% - ${_mb(p.received)} of ${_mb(p.total)} MB';
      case UpdatePhase.verifying:
        return 'Verifying the download...';
      case UpdatePhase.opening:
        return 'Opening the installer...';
    }
  }

  @override
  Widget build(BuildContext context) {
    final info = _info;
    final play = info.playManaged;
    final later = AppUpdateService.laterDuration.inHours;
    return AppDialog(
      icon: Icons.system_update_rounded,
      eyebrow: play ? 'Update required' : 'Update ready',
      title: play ? 'Update ScreenSync' : 'ScreenSync ${info.versionName}',
      message: play
          ? 'Google Play has a newer version (build ${info.versionCode}). It '
              'installs in the background, and this update is required to '
              'keep using the app.'
          : 'A newer build is ready on your hub. Update now for the latest '
              'fixes, or choose Later and we will ask again in $later hours.',
      content: _Details(info: info),
      // Pinned, not scrolling: on a short (landscape) screen the progress and
      // the outcome must stay visible next to the buttons.
      pinned: _Pinned(
        caption: _working ? _caption : null,
        fraction: _progress?.fraction,
        status: _working ? null : _status,
      ),
      actions: [
        if (!play)
          AppDialogAction(label: 'Later', onPressed: _working ? null : _later),
        AppDialogAction(
          label: _working ? _workLabel : 'Update now',
          icon: Icons.download_rounded,
          busy: _working,
          primary: true,
          onPressed: _working ? null : _act,
        ),
      ],
    );
  }
}

String _mb(int bytes) => (bytes / 1048576).toStringAsFixed(1);

/// The version row and the size / checksum chips.
class _Details extends StatelessWidget {
  const _Details({required this.info});

  final AppUpdateInfo info;

  @override
  Widget build(BuildContext context) {
    final installed = info.installedLabel;
    final next = '${info.versionName} (${info.versionCode})';
    final showFrom = !info.playManaged &&
        installed.isNotEmpty &&
        !installed.startsWith('0.0.0');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (!info.playManaged)
          Row(
            children: [
              if (showFrom) ...[
                Expanded(
                  child: _VersionPill(label: 'THIS BUILD', value: installed),
                ),
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 8),
                  child: Icon(Icons.arrow_forward_rounded,
                      size: 18, color: AppTheme.secondary),
                ),
              ],
              Expanded(
                child: _VersionPill(
                    label: 'NEW', value: next, highlighted: true),
              ),
            ],
          ),
        if (!info.playManaged) const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (info.playManaged)
              const _InfoChip(
                  icon: Icons.storefront_rounded, label: 'Google Play'),
            if (info.sizeBytes > 0)
              _InfoChip(
                icon: Icons.cloud_download_outlined,
                label: '${_mb(info.sizeBytes)} MB',
              ),
            if (info.sha256.isNotEmpty)
              _InfoChip(
                icon: Icons.verified_user_outlined,
                label: 'SHA-256 ${info.shortSha}',
                mono: true,
              ),
          ],
        ),
      ],
    );
  }
}

/// Progress while the install runs, then the outcome banner. Pinned above the
/// buttons by [AppDialog.pinned]; grows and shrinks with the shared motion.
class _Pinned extends StatelessWidget {
  const _Pinned({
    required this.caption,
    required this.fraction,
    required this.status,
  });

  /// Non-null while the install is running: the progress block is shown.
  final String? caption;
  final double? fraction;

  /// The service's one-line outcome, shown as a banner once it is done.
  final String? status;

  @override
  Widget build(BuildContext context) {
    return AnimatedSize(
      duration: AppTheme.motionBase,
      curve: AppTheme.motionStandard,
      alignment: Alignment.topCenter,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (caption != null)
            Padding(
              padding: const EdgeInsets.only(top: 14),
              child: _ProgressBlock(caption: caption!, fraction: fraction),
            ),
          if (status != null)
            Padding(
              padding: const EdgeInsets.only(top: 14),
              child: _StatusBanner(
                kind: UpdateDialog.classify(status!),
                text: status!,
              ),
            ),
        ],
      ),
    );
  }
}

class _VersionPill extends StatelessWidget {
  const _VersionPill({
    required this.label,
    required this.value,
    this.highlighted = false,
  });

  final String label;
  final String value;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final textColor = Theme.of(context).textTheme.bodyLarge?.color;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        gradient: highlighted ? AppTheme.gradPrimary : null,
        color: highlighted
            ? null
            : (dark ? AppTheme.darkSurfaceAlt : AppTheme.lightSurfaceAlt),
        borderRadius: BorderRadius.circular(AppTheme.radiusM),
        border: highlighted
            ? null
            : Border.all(
                color: dark ? AppTheme.darkBorder : AppTheme.lightBorder),
        boxShadow: highlighted ? AppTheme.elevLow : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: AppTheme.microLabel.copyWith(
              color: highlighted
                  ? Colors.white.withValues(alpha: 0.88)
                  : AppTheme.darkTextDim,
            ),
          ),
          const SizedBox(height: 3),
          // Scales down instead of ellipsizing, so a longer build such as
          // "2.5.10 (133)" stays readable at 320dp or at a large text scale.
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              maxLines: 1,
              style: AppTheme.typeTitleMedium.copyWith(
                fontSize: 14,
                fontWeight: FontWeight.w800,
                color: highlighted ? Colors.white : textColor,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoChip extends StatelessWidget {
  const _InfoChip({required this.icon, required this.label, this.mono = false});

  final IconData icon;
  final String label;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: dark ? AppTheme.darkSurfaceAlt : AppTheme.lightSurfaceAlt,
        borderRadius: BorderRadius.circular(999),
        border:
            Border.all(color: dark ? AppTheme.darkBorder : AppTheme.lightBorder),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: AppTheme.primary),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: AppTheme.typeCaption.copyWith(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                fontFamily: mono ? 'monospace' : null,
                color: AppTheme.darkTextDim,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ProgressBlock extends StatelessWidget {
  const _ProgressBlock({required this.caption, required this.fraction});

  final String caption;
  final double? fraction;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AppProgressBar(value: fraction),
        const SizedBox(height: 8),
        Text(
          caption,
          style: AppTheme.typeBodyMedium.copyWith(color: AppTheme.darkTextDim),
        ),
      ],
    )
        .animate()
        .fadeIn(duration: AppTheme.motionBase)
        .slideY(
            begin: 0.06,
            end: 0,
            duration: AppTheme.motionBase,
            curve: AppTheme.motionStandard);
  }
}

class _StatusBanner extends StatelessWidget {
  const _StatusBanner({required this.kind, required this.text});

  final UpdateStatusKind kind;
  final String text;

  @override
  Widget build(BuildContext context) {
    final (color, icon) = switch (kind) {
      UpdateStatusKind.success => (AppTheme.success, Icons.check_circle_rounded),
      UpdateStatusKind.attention =>
        (AppTheme.warning, Icons.settings_suggest_rounded),
      UpdateStatusKind.info => (AppTheme.primary, Icons.info_outline_rounded),
      UpdateStatusKind.problem => (AppTheme.danger, Icons.error_outline_rounded),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppTheme.radiusM),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: AppTheme.typeBodyMedium.copyWith(
                height: 1.4,
                color: Theme.of(context).textTheme.bodyLarge?.color,
              ),
            ),
          ),
        ],
      ),
    )
        .animate()
        .fadeIn(duration: AppTheme.motionBase)
        .slideY(
            begin: 0.06,
            end: 0,
            duration: AppTheme.motionBase,
            curve: AppTheme.motionStandard);
  }
}
