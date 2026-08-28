import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:googleapis/drive/v3.dart' as drive;
import 'package:extension_google_sign_in_as_googleapis_auth/extension_google_sign_in_as_googleapis_auth.dart';

class GoogleDriveRepository {
  final GoogleSignIn _googleSignIn = GoogleSignIn(
    scopes: [drive.DriveApi.driveFileScope],
  );

  GoogleSignInAccount? _currentUser;
  drive.DriveApi? _driveApi;
  String? _appFolderId;

  Future<bool> signIn() async {
    try {
      _currentUser = await _googleSignIn.signIn();
      if (_currentUser == null) return false;

      final authClient = await _googleSignIn.authenticatedClient();
      if (authClient == null) return false;

      _driveApi = drive.DriveApi(authClient);
      await _ensureAppFolderExists();
      return true;
    } catch (e) {
      debugPrint('Google Drive Sign-In Error: $e');
      return false;
    }
  }

  Future<void> _ensureAppFolderExists() async {
    if (_driveApi == null) return;

    // Check if ScreenSync_MCP folder exists
    final result = await _driveApi!.files.list(
      q: "mimeType = 'application/vnd.google-apps.folder' and name = 'ScreenSync_MCP' and trashed = false",
      spaces: 'drive',
    );

    if (result.files != null && result.files!.isNotEmpty) {
      _appFolderId = result.files!.first.id;
    } else {
      // Create new folder
      final folderMetadata = drive.File()
        ..name = 'ScreenSync_MCP'
        ..mimeType = 'application/vnd.google-apps.folder';
      final created = await _driveApi!.files.create(folderMetadata);
      _appFolderId = created.id;
    }
  }

  Future<String?> uploadScreenshot({
    required Uint8List imageBytes,
    required String filename,
  }) async {
    if (_driveApi == null || _appFolderId == null) {
      final ok = await signIn();
      if (!ok) return null;
    }

    final driveFile = drive.File()
      ..name = filename
      ..parents = [_appFolderId!];

    final media = drive.Media(
      Stream.value(imageBytes),
      imageBytes.length,
      contentType: 'image/png',
    );

    final uploaded = await _driveApi!.files.create(
      driveFile,
      uploadMedia: media,
    );

    // Auto-cleanup: keep only recent 20 files (debounced — see below).
    _autoCleanupOldScreens();

    return uploaded.id;
  }

  static const _cleanupCooldown = Duration(minutes: 5);
  DateTime _lastCleanup = DateTime.fromMillisecondsSinceEpoch(0);
  bool _cleanupRunning = false;

  void _autoCleanupOldScreens() {
    if (_cleanupRunning) return;
    if (DateTime.now().difference(_lastCleanup) < _cleanupCooldown) return;
    _cleanupRunning = true;
    _runCleanup().whenComplete(() {
      _cleanupRunning = false;
      _lastCleanup = DateTime.now();
    });
  }

  Future<void> _runCleanup() async {
    try {
      final list = await _driveApi!.files.list(
        q: "'$_appFolderId' in parents and trashed = false",
        orderBy: 'createdTime desc',
        pageSize: 50,
      );
      final files = list.files;
      if (files == null || files.length <= 20) return;
      final staleIds = files
          .skip(20)
          .map((file) => file.id)
          .whereType<String>()
          .toList();
      await Future.wait(
        staleIds.map((id) => _driveApi!.files.delete(id)),
        eagerError: false,
      );
    } catch (e) {
      debugPrint('Drive cleanup skipped: $e');
    }
  }
}
