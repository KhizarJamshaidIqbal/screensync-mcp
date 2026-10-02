package com.screensync.mcp

import android.media.Image
import android.os.SystemClock
import android.util.Log

/**
 * The newest frame the capture display produced, kept between captures, with the
 * pictures already encoded from it.
 *
 * A MediaProjection virtual display only gets a frame when the screen content
 * changes, so on a still screen nothing arrives after a capture request. Closing
 * every frame and waiting for the next one made a Snap on a still screen sit out
 * the frame timeout, often twice (about 8 s). [FrameWaiter] keeps the newest
 * frame here instead and answers with it once a short settle window passes with
 * nothing newer: no newer frame means the screen has not changed since this one
 * was drawn, so it is what the screen shows now.
 *
 * Each picture is encoded once per [CaptureRequest], so a repeat capture of a
 * still screen costs no encode, and the same frame can answer a PNG request and a
 * JPEG request without either evicting the other. A newer frame drops them all.
 *
 * Holding one image is safe with the reader's `maxImages = 2`: the producer
 * always has a free buffer, and a newer frame replaces (and closes) this one.
 * Thread-safe; the session can be torn down from the main thread.
 */
class LatestFrame {
    private var image: Image? = null

    // Access-ordered, so the request not used for longest goes first. A full-size PNG is
    // megabytes, so only a few are kept.
    private val encoded = object : LinkedHashMap<CaptureRequest, EncodedCapture>(4, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<CaptureRequest, EncodedCapture>): Boolean =
            size > MAX_ENCODES
    }

    /** Keeps [newer] and closes the frame it replaces. */
    @Synchronized
    fun replace(newer: Image) {
        if (newer === image) return
        image?.close()
        image = newer
        encoded.clear()
    }

    @Synchronized
    fun isHeld(): Boolean = image != null

    /** How long ago the held frame was drawn, or null when none is held. */
    @Synchronized
    fun ageMs(): Long? = image?.let { held ->
        // Image timestamps are CLOCK_MONOTONIC nanoseconds, like System.nanoTime().
        runCatching { (System.nanoTime() - held.timestamp) / 1_000_000 }.getOrNull()
    }

    /** The held frame as [request] asks, encoded on first use. Null when none is held. */
    fun encode(request: CaptureRequest): EncodedCapture? {
        val held: Image
        synchronized(this) {
            held = image ?: return null
            encoded[request]?.let { return it }
        }
        // Encode outside the lock: it takes a while, and teardown must not wait on it.
        val startedAt = SystemClock.uptimeMillis()
        val picture = held.encode(request)
        Log.d(
            TAG,
            "encoded the frame as ${picture.format.wire} ${picture.width}x${picture.height} " +
                "in ${SystemClock.uptimeMillis() - startedAt} ms, ${picture.bytes.size} bytes",
        )
        synchronized(this) { if (image === held) encoded[request] = picture }
        return picture
    }

    /** Drops the held frame. Call before the reader that made it is closed. */
    @Synchronized
    fun clear() {
        image?.close()
        image = null
        encoded.clear()
    }

    private companion object {
        const val TAG = "ScreenSync"
        const val MAX_ENCODES = 3
    }
}
