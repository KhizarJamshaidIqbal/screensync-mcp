import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import '../models/telemetry_event.dart';
import 'device_intent_service.dart';
import 'diagnostics_log_service.dart';

/// Builds the "Share diagnostics" text file and hands it to the Android share
/// sheet. The user picks where it goes; nothing is uploaded by the app.
///
/// The file holds the app version, the phone model, the hub HOST only (never
/// its path, query or the pairing token), the last 30 telemetry events and the
/// tail of [DiagnosticsLogService]'s log. The whole text is redacted once more
/// before it is written.
class DiagnosticsShareService {
  DiagnosticsShareService({
    DiagnosticsLogService? log,
    Future<String> Function()? appVersion,
    Future<String> Function()? deviceModel,
    Future<Directory> Function()? cacheDir,
    Future<bool> Function(String path)? openShareSheet,
    DateTime Function()? clock,
  })  : _log = log ?? DiagnosticsLogService.instance,
        _appVersion = appVersion ?? _loadAppVersion,
        _deviceModel = deviceModel ?? _loadDeviceModel,
        _cacheDir = cacheDir ?? getTemporaryDirectory,
        _openShareSheet = openShareSheet ?? _shareText,
        _clock = clock ?? DateTime.now;

  static final DiagnosticsShareService instance = DiagnosticsShareService();

  /// Written to `<cache>/share/`, the folder the native FileProvider shares.
  static const String reportFileName = 'diagnostics.txt';

  final DiagnosticsLogService _log;
  final Future<String> Function() _appVersion;
  final Future<String> Function() _deviceModel;
  final Future<Directory> Function() _cacheDir;
  final Future<bool> Function(String path) _openShareSheet;
  final DateTime Function() _clock;

  /// Writes the report and opens the share sheet. False when either failed
  /// (the failure itself goes to the log).
  Future<bool> share({
    required String hubUrl,
    required List<TelemetryEvent> telemetry,
  }) async {
    try {
      final file = await writeReport(hubUrl: hubUrl, telemetry: telemetry);
      return await _openShareSheet(file.path);
    } catch (e, s) {
      _log.logError('diagnostics', e, s);
      return false;
    }
  }

  /// Writes `<cache>/share/diagnostics.txt` and returns it.
  Future<File> writeReport({
    required String hubUrl,
    required List<TelemetryEvent> telemetry,
  }) async {
    final version = await _appVersion();
    final device = await _deviceModel();
    final logTail = await _log.tail();
    final text = _log.redact(buildReport(
      appVersion: version,
      deviceModel: device,
      hubUrl: hubUrl,
      telemetry: telemetry,
      logTail: logTail,
      now: _clock(),
    ));
    final dir = Directory('${(await _cacheDir()).path}/share');
    await dir.create(recursive: true);
    final file = File('${dir.path}/$reportFileName');
    await file.writeAsString(text, flush: true);
    return file;
  }

  /// The report text (before the final redaction pass).
  static String buildReport({
    required String appVersion,
    required String deviceModel,
    required String hubUrl,
    required List<TelemetryEvent> telemetry,
    required String logTail,
    required DateTime now,
  }) {
    final events = telemetry.take(TelemetryEvent.maxStored).toList();
    final out = StringBuffer()
      ..writeln('ScreenSync diagnostics')
      ..writeln('Created: ${now.toUtc().toIso8601String()}')
      ..writeln('App version: $appVersion')
      ..writeln('Device: $deviceModel')
      ..writeln('Hub host: ${hubHost(hubUrl)}')
      ..writeln('Pairing token: not included')
      ..writeln()
      ..writeln('== Telemetry (last ${events.length}, newest first) ==');
    if (events.isEmpty) out.writeln('(none)');
    for (final e in events) {
      out.writeln('${e.timestamp.toUtc().toIso8601String()} ${e.kind} '
          '${e.ok ? 'ok' : 'fail'} ${e.durationMs}ms ${e.label}');
    }
    out
      ..writeln()
      ..writeln('== App log (most recent) ==')
      ..writeln(logTail.trim().isEmpty ? '(empty)' : logTail.trimRight());
    return out.toString();
  }

  /// Only the host of the hub address: a path, a query, a fragment or user
  /// info could carry the pairing token, so none of them is kept.
  static String hubHost(String hubUrl) {
    final host = Uri.tryParse(hubUrl.trim())?.host ?? '';
    return host.isEmpty ? '(not set)' : host;
  }

  static Future<String> _loadAppVersion() async {
    final v = await DeviceIntentService.appVersion();
    return '${v.name} (${v.code})';
  }

  static Future<String> _loadDeviceModel() async {
    try {
      final info = await DeviceInfoPlugin().androidInfo;
      return '${info.manufacturer} ${info.model} '
          '(Android ${info.version.release}, SDK ${info.version.sdkInt})';
    } catch (_) {
      return 'unknown';
    }
  }

  static Future<bool> _shareText(String path) => DeviceIntentService.shareFile(
        path,
        mimeType: 'text/plain',
        title: 'Share diagnostics',
        subject: 'ScreenSync diagnostics',
      );
}
