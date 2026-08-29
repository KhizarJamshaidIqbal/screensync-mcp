import 'dart:convert';

import 'package:equatable/equatable.dart';

/// A user-defined capture preset (C1): target width, format and quality,
/// plus an optional per-preset redaction flag.
class CustomPreset extends Equatable {
  const CustomPreset({
    required this.id,
    required this.name,
    required this.maxWidth,
    required this.jpeg,
    required this.jpegQuality,
    this.redact = false,
  });

  final String id;
  final String name;

  /// Long-edge target in px; 0 = native resolution.
  final int maxWidth;

  /// true → JPEG, false → PNG.
  final bool jpeg;
  final int jpegQuality;
  final bool redact;

  String get mime => jpeg ? 'image/jpeg' : 'image/png';

  String get summary {
    final res = maxWidth == 0 ? 'native' : '≤${maxWidth}px';
    final fmt = jpeg ? 'JPEG q$jpegQuality' : 'PNG';
    return '$res · $fmt${redact ? ' · redacted' : ''}';
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'maxWidth': maxWidth,
        'jpeg': jpeg,
        'jpegQuality': jpegQuality,
        'redact': redact,
      };

  factory CustomPreset.fromJson(Map<String, dynamic> json) => CustomPreset(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? 'Preset',
        maxWidth: (json['maxWidth'] as num?)?.toInt() ?? 0,
        jpeg: json['jpeg'] as bool? ?? true,
        jpegQuality: (json['jpegQuality'] as num?)?.toInt() ?? 74,
        redact: json['redact'] as bool? ?? false,
      );

  static List<CustomPreset> decodeList(List<String> raw) {
    final out = <CustomPreset>[];
    for (final entry in raw) {
      try {
        final decoded = jsonDecode(entry);
        if (decoded is Map<String, dynamic>) {
          out.add(CustomPreset.fromJson(decoded));
        }
      } catch (_) {/* skip corrupt rows */}
    }
    return out;
  }

  static List<String> encodeList(List<CustomPreset> presets) =>
      presets.map((p) => jsonEncode(p.toJson())).toList();

  @override
  List<Object?> get props => [id, name, maxWidth, jpeg, jpegQuality, redact];
}
