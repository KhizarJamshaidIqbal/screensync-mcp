package com.screensync.mcp

import android.os.Handler
import android.os.Looper
import android.util.Log
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel

/// EventChannel "com.screensync.mcp/projection_state": a bool that is true while
/// a MediaProjection session is live and capture works, false once it ended or
/// never started.
///
/// It emits the current value the moment a listener attaches and again on every
/// change. [ScreenCaptureService] feeds it through [ScreenCaptureService.stateListener]
/// (projection started, MediaProjection.Callback.onStop, service destroyed), so
/// Dart no longer has to guess from a stale "capture ready" flag.
class ProjectionStateStream : EventChannel.StreamHandler {
    companion object {
        const val CHANNEL = "com.screensync.mcp/projection_state"
        private const val TAG = "ScreenSync"
    }

    private val main = Handler(Looper.getMainLooper())
    private val listener = ScreenCaptureService.StateListener { active -> publish(active) }

    // Touched on the main thread only.
    private var sink: EventChannel.EventSink? = null
    private var last: Boolean? = null

    fun attach(messenger: BinaryMessenger) {
        EventChannel(messenger, CHANNEL).setStreamHandler(this)
        ScreenCaptureService.stateListener = listener
    }

    /// The engine is going away: stop feeding a sink nobody reads.
    fun detach() {
        if (ScreenCaptureService.stateListener === listener) {
            ScreenCaptureService.stateListener = null
        }
        main.post {
            sink = null
            last = null
        }
    }

    override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
        sink = events
        // The service is the single source of truth, not a cached copy.
        val now = ScreenCaptureService.isReady()
        last = now
        events?.success(now)
    }

    override fun onCancel(arguments: Any?) {
        sink = null
        last = null
    }

    /// Any thread: marshals to the main thread and drops repeats of the last value.
    private fun publish(active: Boolean) {
        main.post {
            val events = sink ?: return@post
            if (last == active) return@post
            last = active
            try {
                events.success(active)
            } catch (e: Exception) {
                Log.w(TAG, "projection_state emit failed", e)
            }
        }
    }
}
