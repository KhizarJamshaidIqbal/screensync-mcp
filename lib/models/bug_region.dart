import 'dart:ui';

import 'package:equatable/equatable.dart';

/// Severity for annotated bug regions returned by the desktop inspection pass.
enum BugSeverity { error, warning, info }

class BugRegion extends Equatable {
  final String id;
  final String label;

  /// Normalized [0..1] coords relative to the full captured frame.
  final double x, y, w, h;
  final BugSeverity severity;

  const BugRegion({
    required this.id,
    required this.label,
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    required this.severity,
  });

  Color get color => switch (severity) {
        BugSeverity.error => const Color(0xFFEF4444),
        BugSeverity.warning => const Color(0xFFF59E0B),
        BugSeverity.info => const Color(0xFF7C3AED),
      };

  factory BugRegion.fromJson(Map<String, dynamic> json) => BugRegion(
        id: json['id'] as String? ?? 'bug',
        label: json['label'] as String? ?? 'UI defect',
        x: (json['x'] as num?)?.toDouble() ?? 0,
        y: (json['y'] as num?)?.toDouble() ?? 0,
        w: (json['w'] as num?)?.toDouble() ?? 0,
        h: (json['h'] as num?)?.toDouble() ?? 0,
        severity: BugSeverity.values.asNameMap()[json['severity']] ??
            BugSeverity.warning,
      );

  @override
  List<Object?> get props => [id, label, x, y, w, h, severity];
}
