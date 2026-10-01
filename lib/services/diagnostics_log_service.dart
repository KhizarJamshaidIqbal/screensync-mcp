import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../models/telemetry_event.dart';

/// A small on-device diagnostics log, so a problem on someone else's phone can
/// be debugged from the file they choose to share (Telemetry tab, "Share
/// diagnostics"). Nothing here ever leaves the phone on its own.
///
/// * Lives in `<application support>/logs/app.log`; on Android that is
///   `<data>/files/logs`, inside the app's private storage.
/// * Rotates: when an entry would push `app.log` past [maxBytes] the file
///   becomes `app.log.1` (replacing the older one), so at most two files of
///   512 KB are ever kept.
/// * One entry per line: `<ISO-8601 UTC time> <tag> <message>`. The extra
///   lines of a multi-line message (a stack trace) are indented by two spaces,
///   so every unindented line still starts with a timestamp.
/// * Every entry is redacted before it is written: `Bearer <anything>`, a
///   `...token=` URL parameter and every value [secrets] returns (the stored
///   pairing token and the tokens of remembered hubs) become [redactedMark].
///
/// Callers log events and errors only. Never pass text the user typed (the hub
/// address or token fields) or text an agent types on the phone.
class DiagnosticsLogService {
  DiagnosticsLogService({
    Future<Directory> Function()? baseDir,
    this.maxBytes = defaultMaxBytes,
    DateTime Function()? clock,
  })  : _baseDir = baseDir ?? getApplicationSupportDirectory,
        _clock = clock ?? DateTime.now;

  static final DiagnosticsLogService instance = DiagnosticsLogService();

  static const int defaultMaxBytes = 512 * 1024;
  static const String fileName = 'app.log';
  static const String rotatedName = 'app.log.1';
  static const String redactedMark = '[redacted]';

  /// One entry is capped so a runaway message cannot fill a file by itself.
  static const int maxEntryChars = 8000;
  static const int maxStackLines = 24;

  static final _bearer = RegExp(r'Bearer\s+\S+', caseSensitive: false);
  // `token=`, `access_token=`, `pairing_token=`... in a URL or query string.
  static final _tokenParam =
      RegExp(r'([?&#;][a-z_]*token=)[^&#\s]+', caseSensitive: false);

  final Future<Directory> Function() _baseDir;
  final DateTime Function() _clock;

  /// Size cap of one log file, in bytes.
  final int maxBytes;

  /// Values scrubbed from every entry. main.dart points this at the pairing
  /// token store once settings are loaded.
  Iterable<String> Function() secrets = () => const <String>[];

  Future<void> _queue = Future<void>.value();
  Directory? _dir;
  bool _unavailable = false;
  int? _size;

  /// Appends one entry. Never throws: an entry that cannot be written is
  /// dropped. Writes are serialised, so rotation never races another write.
  Future<void> log(String tag, String message) {
    final entry = format(tag, message);
    return _queue = _queue.then((_) => _append(entry));
  }

  /// Logs an error and the top of its stack trace.
  Future<void> logError(String tag, Object error, StackTrace? stack) {
    final frames = stack
        ?.toString()
        .split('\n')
        .where((l) => l.trim().isNotEmpty)
        .take(maxStackLines)
        .join('\n');
    return log(tag, frames == null || frames.isEmpty ? '$error' : '$error\n$frames');
  }

  /// Mirrors one telemetry event (the Telemetry tab keeps only the last 30).
  Future<void> logTelemetry(TelemetryEvent event) => log(
        'telemetry',
        '${event.kind} ${event.ok ? 'ok' : 'fail'} ${event.durationMs}ms '
            '${event.label}',
      );

  /// The newest [maxBytes] of the log across both files, oldest line first.
  /// Redacted again with today's secrets, in case the token changed after a
  /// line was written. Empty when there is no log.
  Future<String> tail({int maxBytes = 64 * 1024}) async {
    await _queue;
    try {
      final dir = await _logDir();
      if (dir == null) return '';
      final bytes = <int>[];
      for (final name in const [rotatedName, fileName]) {
        final file = File('${dir.path}/$name');
        if (await file.exists()) bytes.addAll(await file.readAsBytes());
      }
      final start = bytes.length > maxBytes ? bytes.length - maxBytes : 0;
      var text = utf8.decode(bytes.sublist(start), allowMalformed: true);
      if (start > 0) {
        // The cut landed mid-line: drop the partial first line.
        final newline = text.indexOf('\n');
        if (newline >= 0) text = text.substring(newline + 1);
      }
      return redact(text);
    } catch (_) {
      return '';
    }
  }

  /// Scrubs bearer credentials, `token=` parameters and [secrets] from [text].
  String redact(String text) {
    var out = text;
    // Longest first, so a secret that contains another is removed whole.
    final values = _secretValues()..sort((a, b) => b.length - a.length);
    for (final secret in values) {
      out = out.replaceAll(secret, redactedMark);
    }
    out = out.replaceAll(_bearer, 'Bearer $redactedMark');
    return out.replaceAllMapped(_tokenParam, (m) => '${m[1]}$redactedMark');
  }

  /// One formatted entry, newline included. Redaction runs before the length
  /// cap, so the cap can never cut a secret in half and leave a piece of it.
  String format(String tag, String message) {
    final time = _clock().toUtc().toIso8601String();
    final cleanTag = tag.trim().isEmpty
        ? 'app'
        : tag.trim().replaceAll(RegExp(r'\s+'), '_');
    var body = redact(message).replaceAll('\r\n', '\n').trimRight();
    if (body.length > maxEntryChars) {
      body = '${body.substring(0, maxEntryChars)}...';
    }
    return '$time $cleanTag ${body.replaceAll('\n', '\n  ')}\n';
  }

  List<String> _secretValues() {
    try {
      return [
        for (final s in secrets())
          if (s.trim().isNotEmpty) s.trim(),
      ];
    } catch (_) {
      return <String>[]; // settings not loaded yet: nothing stored to leak
    }
  }

  Future<void> _append(String entry) async {
    try {
      final dir = await _logDir();
      if (dir == null) return;
      final bytes = utf8.encode(entry);
      final current = File('${dir.path}/$fileName');
      var size = _size ?? (await current.exists() ? await current.length() : 0);
      if (size > 0 && size + bytes.length > maxBytes) {
        final rotated = File('${dir.path}/$rotatedName');
        if (await rotated.exists()) await rotated.delete();
        await current.rename(rotated.path);
        size = 0;
      }
      await current.writeAsBytes(bytes, mode: FileMode.append, flush: true);
      _size = size + bytes.length;
    } catch (_) {
      _size = null; // measure the file again next time
    }
  }

  Future<Directory?> _logDir() async {
    if (_dir != null) return _dir;
    if (_unavailable) return null;
    try {
      final base = await _baseDir();
      final dir = Directory('${base.path}/logs');
      await dir.create(recursive: true);
      return _dir = dir;
    } catch (_) {
      // No storage here (a unit test, a second engine): stay silent.
      _unavailable = true;
      return null;
    }
  }
}
