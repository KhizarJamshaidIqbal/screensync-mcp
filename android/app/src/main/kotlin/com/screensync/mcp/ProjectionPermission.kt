package com.screensync.mcp

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import io.flutter.plugin.common.MethodChannel

/// The MediaProjection consent dialog ("prepareCapture") and the one pending
/// Dart call waiting for its answer.
///
/// The consent dialog can be left open forever (or dismissed in a way that never
/// reports back), so the pending call has a hard [TIMEOUT_MS] limit: it then
/// completes with the error code "permission_timeout" and the pending state is
/// cleared. Without that a Dart prepare() hangs, and every later call fails with
/// "permission_request_active".
class ProjectionPermission(private val activity: Activity) {
    companion object {
        const val REQUEST_CODE = 7301
        const val TIMEOUT_MS = 60_000L
        private const val TAG = "ScreenSync"
    }

    private val manager: MediaProjectionManager by lazy {
        activity.getSystemService(MediaProjectionManager::class.java)
    }
    private val handler = Handler(Looper.getMainLooper())
    private val timeoutTask = Runnable { onTimeout() }
    private var pending: MethodChannel.Result? = null

    fun prepare(result: MethodChannel.Result) {
        if (ScreenCaptureService.isReady()) {
            result.success(true)
            return
        }
        if (pending != null) {
            result.error(
                "permission_request_active",
                "A screen capture permission request is already open.",
                null,
            )
            return
        }
        pending = result
        handler.postDelayed(timeoutTask, TIMEOUT_MS)
        try {
            @Suppress("DEPRECATION")
            activity.startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CODE)
        } catch (e: Exception) {
            // The dialog never opened: nothing will ever answer, so do not leave
            // the pending state behind to block the next prepare().
            Log.e(TAG, "could not open the screen capture consent dialog", e)
            clearPending()?.error("permission_request_failed", e.message, null)
        }
    }

    /// Handles the consent dialog's answer. Returns true when [requestCode] was
    /// ours. A grant that arrives after the timeout is still honoured (the owner
    /// did allow capture); Dart learns about it from the projection_state stream.
    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (requestCode != REQUEST_CODE) return false
        val result = clearPending()
        if (resultCode == Activity.RESULT_OK && data != null) {
            ScreenCaptureService.start(activity, resultCode, data)
            result?.success(true)
        } else {
            result?.success(false)
        }
        return true
    }

    /// The activity is going away: no answer can arrive any more.
    fun cancelPending() {
        clearPending()?.error(
            "activity_destroyed",
            "The capture permission request was interrupted.",
            null,
        )
    }

    private fun onTimeout() {
        Log.w(TAG, "screen capture consent timed out after ${TIMEOUT_MS / 1000}s")
        clearPending()?.error(
            "permission_timeout",
            "The screen capture permission dialog was not answered in time.",
            null,
        )
    }

    /// Drops the pending call (and its timeout) and hands it back exactly once.
    private fun clearPending(): MethodChannel.Result? {
        handler.removeCallbacks(timeoutTask)
        val result = pending
        pending = null
        return result
    }
}
