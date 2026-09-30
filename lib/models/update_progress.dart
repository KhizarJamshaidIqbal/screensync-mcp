import 'package:equatable/equatable.dart';

/// The stage a hub update is in, for the update dialog's progress bar.
enum UpdatePhase { downloading, verifying, opening }

/// One progress report from `AppUpdateService.downloadAndInstall`.
class UpdateProgress extends Equatable {
  const UpdateProgress(this.phase, {this.received = 0, this.total = 0});

  const UpdateProgress.downloading(int received, int total)
      : this(UpdatePhase.downloading, received: received, total: total);

  const UpdateProgress.verifying() : this(UpdatePhase.verifying);

  const UpdateProgress.opening() : this(UpdatePhase.opening);

  final UpdatePhase phase;

  /// Bytes written so far; only meaningful while [UpdatePhase.downloading].
  final int received;

  /// Expected size in bytes, 0 when the hub did not say.
  final int total;

  /// 0..1 while the download size is known, null when it is not (the bar then
  /// shows an indeterminate state). Verifying and opening happen after the
  /// whole file is on disk, so they read as complete.
  double? get fraction {
    if (phase != UpdatePhase.downloading) return 1;
    if (total <= 0) return null;
    return (received / total).clamp(0.0, 1.0);
  }

  /// Whole percent for display, or null when [fraction] is unknown.
  int? get percent {
    final f = fraction;
    return f == null ? null : (f * 100).floor();
  }

  @override
  List<Object?> get props => [phase, received, total];
}
