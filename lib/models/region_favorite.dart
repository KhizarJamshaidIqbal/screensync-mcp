import 'dart:convert';

import 'package:equatable/equatable.dart';

import '../services/capture_pipeline_service.dart';

/// A named, saved crop region (C3) so repeat inspections of the same screen
/// area are one tap instead of a fresh drag every time.
class RegionFavorite extends Equatable {
  const RegionFavorite({
    required this.name,
    required this.nx,
    required this.ny,
    required this.nw,
    required this.nh,
  });

  final String name;
  final double nx, ny, nw, nh;

  NormRect get rect => NormRect(nx, ny, nw, nh);

  String get summary =>
      '${(nw * 100).round()}×${(nh * 100).round()}% @ '
      '${(nx * 100).round()},${(ny * 100).round()}';

  Map<String, dynamic> toJson() =>
      {'name': name, 'nx': nx, 'ny': ny, 'nw': nw, 'nh': nh};

  factory RegionFavorite.fromJson(Map<String, dynamic> json) => RegionFavorite(
        name: json['name'] as String? ?? 'Region',
        nx: (json['nx'] as num?)?.toDouble() ?? 0,
        ny: (json['ny'] as num?)?.toDouble() ?? 0,
        nw: (json['nw'] as num?)?.toDouble() ?? 1,
        nh: (json['nh'] as num?)?.toDouble() ?? 1,
      );

  static List<RegionFavorite> decodeList(List<String> raw) {
    final out = <RegionFavorite>[];
    for (final entry in raw) {
      try {
        final decoded = jsonDecode(entry);
        if (decoded is Map<String, dynamic>) {
          out.add(RegionFavorite.fromJson(decoded));
        }
      } catch (_) {/* skip corrupt rows */}
    }
    return out;
  }

  static List<String> encodeList(List<RegionFavorite> favs) =>
      favs.map((f) => jsonEncode(f.toJson())).toList();

  @override
  List<Object?> get props => [name, nx, ny, nw, nh];
}
