import 'dart:async';
import 'dart:io' as io;

import 'package:flutter/foundation.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:path_provider/path_provider.dart';

import '../models/captured_frame.dart';
import '../repositories/capture_cache_repository.dart';
import '../repositories/screen_repository.dart';
import '../repositories/sync_mode.dart';
import '../services/capture_pipeline_service.dart';
import '../services/capture_trigger_bridge.dart';
import '../services/connection_metrics_service.dart';
import '../services/device_intent_service.dart';
import '../services/settings_service.dart';
import 'screen_capture_event.dart';
import 'screen_capture_state.dart';

/// Persisting captured frames locally and delivering them (LAN hub / Drive),
/// plus the gallery and pending-sync events built on the same cache.
mixin CaptureSyncMixin on Bloc<ScreenCaptureEvent, ScreenCaptureState> {
  ScreenRepository get hubRepo;
  SettingsService get hubSettings;
  ConnectionMetricsService get metrics;
  CaptureCacheRepository get cacheRepo;

  void registerCaptureSync() {
    on<LoadGalleryEvent>(_onLoadGallery);
    on<SyncPendingEvent>(_onSyncPending);
    on<DeleteFrameEvent>(_onDeleteFrame);
  }

  /// C2: opt-in privacy redaction (pixelation) BEFORE anything is
  /// persisted or uploaded. No-op when the setting is off.
  Future<CapturedFrame> _applyRedaction(CapturedFrame frame) async {
    if (!hubSettings.redactionEnabled) return frame;
    try {
      final jpeg = frame.mimeType == 'image/jpeg';
      final redacted = await CapturePipeline.redact(
        frame.imageBytes,
        jpeg: jpeg,
      );
      return CapturedFrame(
        imageBytes: redacted,
        mimeType: frame.mimeType,
        filename: frame.filename,
        timestamp: frame.timestamp,
      );
    } catch (_) {
      // Redaction must never lose a capture — fall back to the original.
      return frame;
    }
  }

  /// Persists a captured frame and pushes it through the sync pipeline
  /// (LAN hub / Drive per current sync mode). Shared by tap-capture and
  /// region-crop commit so both take the exact same delivery path.
  Future<void> persistAndSync(
      CapturedFrame rawFrame, Emitter<ScreenCaptureState> emit) async {
    // C2: apply opt-in privacy redaction BEFORE anything is persisted or
    // uploaded. No-op when the setting is off.
    final frame = await _applyRedaction(rawFrame);
    final cacheId = await _persistFrame(frame);

    // Live-bridge: every successful capture (regardless of where it ends up)
    // bumps the session counter so the hero stats stay accurate.
    metrics.incrementCaptures();
    add(const SessionStatsChangedEvent());

    // Each transport is isolated so a hub-side exception can never skip
    // the Drive fallback (hybrid mode), and vice versa.
    var hubOk = false;
    var driveOk = false;
    if (state.syncMode == SyncMode.lanMdns ||
        state.syncMode == SyncMode.hybrid) {
      try {
        hubOk = await hubRepo.pushToLocalMcpServer(frame);
      } catch (_) {
        hubOk = false;
      }
      if (!hubOk) metrics.recordDroppedFrame();
      if (hubOk) add(FrameSeenEvent(DateTime.now()));
      if (cacheId != null && hubOk) {
        await cacheRepo.markSyncedHub(cacheId);
        metrics.incrementHubPush();
        add(const SessionStatsChangedEvent());
      }
    }
    if (!hubOk &&
        (state.syncMode == SyncMode.googleDrive ||
            state.syncMode == SyncMode.hybrid)) {
      try {
        await hubRepo.uploadToGoogleDrive(frame);
        driveOk = true;
        if (cacheId != null) await cacheRepo.markSyncedDrive(cacheId);
        metrics.incrementDrivePush();
        add(const SessionStatsChangedEvent());
      } catch (_) {
        driveOk = false;
      }
    }
    if (!hubOk && !driveOk) {
      if (state.syncMode == SyncMode.lanMdns) {
        throw StateError(
          'Captured the screen, but could not reach the desktop ScreenSync '
          'hub at ${hubRepo.hubUrl}. Open Settings → Hub to pick one.',
        );
      }
      throw StateError(
        'Captured the screen and saved it locally, but neither the desktop '
        'hub nor Google Drive could be reached. Use Sync pending to retry.',
      );
    }

    final gallery = await cacheRepo.recentFrames();
    final unsynced = await cacheRepo.unsyncedHubCount();
    metrics.setUnsynced(unsynced);
    add(const SessionStatsChangedEvent());
    emit(state.copyWith(
      status: CaptureStatus.success,
      errorMessage: null,
      gallery: gallery,
      latestFramePath:
          gallery.isEmpty ? state.latestFramePath : gallery.first.filePath,
      unsyncedCount: unsynced,
    ));
  }

  /// Writes frame + thumbnail into app storage and the SQLite history.
  Future<int?> _persistFrame(CapturedFrame frame) async {
    try {
      final docs = await getApplicationDocumentsDirectory();
      final path = await CapturePipeline.persist(
          frame.imageBytes, frame.filename, docs.path);
      CaptureTriggerBridge.writeLatestFramePointer(path).ignore();
      final thumbBytes = await CapturePipeline.thumbnail(frame.imageBytes);
      final tdir = await cacheRepo.thumbsDir;
      final base = frame.filename.replaceAll(RegExp(r'\.(png|jpg)$'), '');
      final thumbFile = io.File('${tdir.path}/t_$base.png');
      await thumbFile.writeAsBytes(thumbBytes, flush: true);
      return cacheRepo.saveFrame(
        filename: frame.filename,
        filePath: path,
        width: frame.width,
        height: frame.height,
        byteLength: frame.imageBytes.lengthInBytes,
        thumbPath: thumbFile.path,
      );
    } catch (e) {
      debugPrint('Frame cache persist failed: $e');
      return null;
    }
  }

  Future<void> _onLoadGallery(
      LoadGalleryEvent event, Emitter<ScreenCaptureState> emit) async {
    final frames = await cacheRepo.recentFrames();
    final unsynced = await cacheRepo.unsyncedHubCount();
    metrics.setUnsynced(unsynced);
    emit(state.copyWith(
      gallery: frames,
      unsyncedCount: unsynced,
      latestFramePath:
          frames.isEmpty ? state.latestFramePath : frames.first.filePath,
      telemetry: hubSettings.telemetryLog,
      sessionStats: metrics.sessionStats,
      activityFeed: metrics.activityFeed,
      latencyHistory: metrics.latencyHistory,
    ));
  }

  /// Processes notification-action snaps (captured while the UI was closed)
  /// plus any older unsynced rows, pushing them to the hub.
  Future<void> _onSyncPending(
      SyncPendingEvent event, Emitter<ScreenCaptureState> emit) async {
    final drained = await DeviceIntentService.drainPendingSnaps();
    var pushed = 0;
    for (final bytes in drained) {
      try {
        final frame = CapturedFrame(imageBytes: bytes, mimeType: 'image/png');
        final id = await _persistFrame(frame);
        if (await hubRepo.pushToLocalMcpServer(frame)) {
          if (id != null) await cacheRepo.markSyncedHub(id);
          pushed++;
        }
      } catch (_) {/* keep pushing the rest */}
    }
    // Backlog: captured frames whose first push failed (hub was down).
    if (await hubRepo.pingHub()) {
      for (final entry in await cacheRepo.unsyncedHubFrames()) {
        try {
          final file = io.File(entry.filePath);
          if (!await file.exists()) continue;
          final frame = CapturedFrame(
            imageBytes: await file.readAsBytes(),
            filename: entry.filename,
            timestamp: entry.capturedAt,
            mimeType:
                entry.filename.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
          );
          if (await hubRepo.pushToLocalMcpServer(frame)) {
            await cacheRepo.markSyncedHub(entry.id);
            pushed++;
          }
        } catch (_) {/* keep pushing the rest */}
      }
    }
    emit(state.copyWith(
      gallery: await cacheRepo.recentFrames(),
      unsyncedCount: await cacheRepo.unsyncedHubCount(),
      errorMessage: pushed > 0
          ? 'Synced $pushed frame(s) to the hub.'
          : state.errorMessage,
    ));
  }

  Future<void> _onDeleteFrame(
      DeleteFrameEvent event, Emitter<ScreenCaptureState> emit) async {
    await cacheRepo.deleteFrame(event.entry);
    final frames = await cacheRepo.recentFrames();
    emit(state.copyWith(
      gallery: frames,
      unsyncedCount: await cacheRepo.unsyncedHubCount(),
      latestFramePath:
          frames.isEmpty ? state.latestFramePath : frames.first.filePath,
    ));
  }
}
