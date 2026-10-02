package com.screensync.mcp

import android.graphics.Bitmap
import android.media.Image
import java.io.ByteArrayOutputStream

/**
 * The newest frame the capture display produced, kept between captures, with
 * its PNG once encoded.
 *
 * A MediaProjection virtual display only gets a frame when the screen content
 * changes, so on a still screen nothing arrives after a capture request. Closing
 * every frame and waiting for the next one made a Snap on a still screen sit out
 * the frame timeout, often twice (about 8 s). [FrameWaiter] keeps the newest
 * frame here instead and answers with it once a short settle window passes with
 * nothing newer: no newer frame means the screen has not changed since this one
 * was drawn, so it is what the screen shows now. The PNG is encoded once, so a
 * repeat capture of a still screen costs no encode.
 *
 * Holding one image is safe with the reader's `maxImages = 2`: the producer
 * always has a free buffer, and a newer frame replaces (and closes) this one.
 * Thread-safe; the session can be torn down from the main thread.
 */
class LatestFrame {
    private var image: Image? = null
    private var png: ByteArray? = null

    /** Keeps [newer] and closes the frame it replaces. */
    @Synchronized
    fun replace(newer: Image) {
        if (newer === image) return
        image?.close()
        image = newer
        png = null
    }

    @Synchronized
    fun isHeld(): Boolean = image != null

    /** How long ago the held frame was drawn, or null when none is held. */
    @Synchronized
    fun ageMs(): Long? = image?.let { held ->
        // Image timestamps are CLOCK_MONOTONIC nanoseconds, like System.nanoTime().
        runCatching { (System.nanoTime() - held.timestamp) / 1_000_000 }.getOrNull()
    }

    /** The held frame as PNG, encoded on first use. Null when none is held. */
    fun png(): ByteArray? {
        val held: Image
        synchronized(this) {
            held = image ?: return null
            png?.let { return it }
        }
        // Encode outside the lock: it takes a while, and teardown must not wait on it.
        val encoded = held.toPng()
        synchronized(this) { if (image === held) png = encoded }
        return encoded
    }

    /** Drops the held frame. Call before the reader that made it is closed. */
    @Synchronized
    fun clear() {
        image?.close()
        image = null
        png = null
    }
}

/** Encodes an RGBA_8888 frame as a PNG, dropping the row padding. */
fun Image.toPng(): ByteArray {
    val plane = planes.first()
    val buffer = plane.buffer
    // copyPixelsFromBuffer moves the position; a frame read before reads as empty.
    buffer.rewind()
    val pixelStride = plane.pixelStride
    val rowPadding = plane.rowStride - pixelStride * width
    val paddedWidth = width + rowPadding / pixelStride

    val paddedBitmap = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888)
    paddedBitmap.copyPixelsFromBuffer(buffer)
    val croppedBitmap = Bitmap.createBitmap(paddedBitmap, 0, 0, width, height)

    return ByteArrayOutputStream().use { output ->
        if (!croppedBitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) {
            throw IllegalStateException("Could not encode the captured frame as PNG.")
        }
        croppedBitmap.recycle()
        paddedBitmap.recycle()
        output.toByteArray()
    }
}
