package com.screensync.mcp

import android.media.Image
import android.media.ImageReader
import android.os.Handler
import android.os.SystemClock
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Matches one capture request at a time to the frame that answers it.
 *
 * A frame that arrives after the request answers it at once. A virtual display
 * only gets a frame when the screen content changes, so when none arrives within
 * [SETTLE_MS] the screen has not changed since the newest frame drawn before the
 * request, and that frame answers it (see [LatestFrame]). The newest frame stays
 * held either way. With no frame held at all (nothing drawn since the session
 * started, or since the screen went off), the wait runs to the timeout,
 * re-primes once and then fails, as before.
 *
 * Runs on [handler]'s thread, except [fail] and [dropHeld], which any thread
 * may call.
 */
class FrameWaiter(
    private val handler: Handler,
    /** Re-primes the capture surface before the one retry. */
    private val reprime: () -> Unit,
    /** False while the screen is off: nothing is drawn, so the held frame may be stale. */
    private val screenIsOn: () -> Boolean,
) {
    private val pending = AtomicBoolean(false)
    private val latest = LatestFrame()
    @Volatile
    private var callback: ((Result<ByteArray>) -> Unit)? = null
    private var retried = false
    private var requestedAt = 0L
    private val timeout = Runnable { onTimeout() }
    private val settle = Runnable { answerWithLatest() }

    /**
     * Starts the wait for the frame that answers [onResult]. Returns false when
     * another capture is still waiting.
     */
    fun begin(reader: ImageReader?, onResult: (Result<ByteArray>) -> Unit): Boolean {
        if (!pending.compareAndSet(false, true)) return false
        callback = onResult
        retried = false
        requestedAt = SystemClock.uptimeMillis()
        // A frame already queued was drawn before this request: it cannot answer
        // it, but it is the newest picture of the screen, so it is the fallback.
        runCatching { reader?.acquireLatestImage() }.getOrNull()?.let(latest::replace)
        handler.postDelayed(settle, SETTLE_MS)
        armTimeout()
        return true
    }

    /** A new frame: kept as the newest, and the answer when a capture waits. */
    fun onFrame(image: Image) {
        latest.replace(image)
        if (pending.compareAndSet(true, false)) answer("a new frame")
    }

    /** Ends the waiting capture, if any, with [message]. */
    fun fail(message: String) {
        if (!pending.compareAndSet(true, false)) return
        stopTimers()
        val waiting = callback
        callback = null
        waiting?.invoke(Result.failure(IllegalStateException(message)))
    }

    /** Drops the held frame. Call before the reader that made it is closed. */
    fun dropHeld() = latest.clear()

    /** Nothing newer arrived in [SETTLE_MS]: the held frame shows the screen now. */
    private fun answerWithLatest() {
        if (!pending.get() || !screenIsOn() || !latest.isHeld()) return
        val age = latest.ageMs()
        if (pending.compareAndSet(true, false)) answer("the held frame, drawn $age ms before")
    }

    private fun answer(which: String) {
        stopTimers()
        Log.d(TAG, "capture answered after ${SystemClock.uptimeMillis() - requestedAt} ms with $which")
        val waiting = callback
        callback = null
        try {
            val png = latest.png() ?: throw IllegalStateException("Screen capture session stopped.")
            waiting?.invoke(Result.success(png))
        } catch (error: Throwable) {
            waiting?.invoke(Result.failure(error))
        }
    }

    private fun armTimeout() {
        handler.removeCallbacks(timeout)
        handler.postDelayed(timeout, TIMEOUT_MS)
    }

    /**
     * Some devices (notably Android 13) don't push a frame until the
     * virtual-display surface is re-primed — retry once before failing.
     */
    private fun onTimeout() {
        if (!pending.get()) return
        if (!retried) {
            retried = true
            reprime()
            armTimeout()
            return
        }
        fail("Timed out waiting for a screen frame.")
    }

    /** A finished request's timers must not fire into the next request's wait. */
    private fun stopTimers() {
        handler.removeCallbacks(timeout)
        handler.removeCallbacks(settle)
    }

    private companion object {
        const val TAG = "ScreenSync"
        const val TIMEOUT_MS = 4_000L

        // Long enough for a frame drawn just before the request to arrive.
        const val SETTLE_MS = 350L
    }
}
