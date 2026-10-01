import 'dart:math' as math;

/// Numeric comparison of `2.5.4+32`-style versions: negative when [a] is older
/// than [b], zero when equal, positive when newer. Segments compare as numbers
/// (so 2.5.10 is newer than 2.5.9); the `+build` part breaks ties.
int compareUpdateVersions(String a, String b) {
  final pa = _parseVersion(a);
  final pb = _parseVersion(b);
  final length = math.max(pa.segments.length, pb.segments.length);
  for (var i = 0; i < length; i++) {
    final x = i < pa.segments.length ? pa.segments[i] : 0;
    final y = i < pb.segments.length ? pb.segments[i] : 0;
    if (x != y) return x < y ? -1 : 1;
  }
  return pa.build.compareTo(pb.build);
}

({List<int> segments, int build}) _parseVersion(String raw) {
  final plus = raw.indexOf('+');
  final name = (plus < 0 ? raw : raw.substring(0, plus)).trim();
  final build =
      plus < 0 ? 0 : int.tryParse(raw.substring(plus + 1).trim()) ?? 0;
  final segments = name.split('.').map((part) {
    final digits = RegExp(r'^\d+').stringMatch(part.trim());
    return digits == null ? 0 : int.parse(digits);
  }).toList();
  return (segments: segments, build: build);
}

/// Whether the published build is newer than the installed one. The
/// versionCode decides when both are known (it is what Android compares);
/// otherwise the version names do.
bool isNewerUpdateBuild({
  required String installedName,
  required int installedCode,
  required String remoteName,
  required int remoteCode,
}) {
  if (installedCode > 0 && remoteCode > 0) return remoteCode > installedCode;
  return compareUpdateVersions(remoteName, installedName) > 0;
}
