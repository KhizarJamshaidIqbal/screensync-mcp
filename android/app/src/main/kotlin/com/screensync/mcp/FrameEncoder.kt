package com.screensync.mcp

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.media.Image
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

private val resamplePaint = Paint(Paint.FILTER_BITMAP_FLAG)

/**
 * Crops, scales and encodes an RGBA_8888 frame as [request] asks, dropping the row
 * padding on the way. A JPEG preset gets the final, smaller picture here, with no
 * full-resolution PNG in between.
 */
fun Image.encode(request: CaptureRequest): EncodedCapture {
    val plane = planes.first()
    val buffer = plane.buffer
    // copyPixelsFromBuffer moves the position; a frame read before reads as empty.
    buffer.rewind()
    val pixelStride = plane.pixelStride
    val rowPadding = plane.rowStride - pixelStride * width
    val paddedWidth = width + rowPadding / pixelStride

    val frame = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888)
    var fitted: Bitmap? = null
    try {
        frame.copyPixelsFromBuffer(buffer)
        val region = request.crop?.toRect(width, height) ?: Rect(0, 0, width, height)
        val picture = fit(frame, region, request.maxWidth)
        fitted = picture
        return ByteArrayOutputStream().use { output ->
            if (!picture.compress(request.format.compressFormat, request.jpegQuality, output)) {
                throw IllegalStateException("Could not encode the captured frame as ${request.format.wire}.")
            }
            EncodedCapture(output.toByteArray(), request.format, picture.width, picture.height)
        }
    } finally {
        fitted?.takeIf { it !== frame }?.recycle()
        frame.recycle()
    }
}

/** [region] of [frame] at no more than [maxWidth] wide. Returns [frame] itself when nothing has to change. */
private fun fit(frame: Bitmap, region: Rect, maxWidth: Int?): Bitmap {
    val targetWidth = minOf(maxWidth ?: region.width(), region.width())
    if (targetWidth < region.width()) return scaleTo(frame, region, targetWidth)
    val whole = region.left == 0 && region.top == 0 &&
        region.width() == frame.width && region.height() == frame.height
    return if (whole) frame else Bitmap.createBitmap(frame, region.left, region.top, region.width(), region.height())
}

private fun scaleTo(frame: Bitmap, region: Rect, targetWidth: Int): Bitmap {
    var current = frame
    var from = Rect(region)
    try {
        // Bilinear sampling skips pixels once the reduction passes 2x, which shreds
        // small text, so halve until the last step is under 2x.
        while (from.width() >= targetWidth * 2) {
            val half = resample(current, from, from.width() / 2)
            if (current !== frame) current.recycle()
            current = half
            from = Rect(0, 0, half.width, half.height)
        }
        return resample(current, from, targetWidth)
    } finally {
        if (current !== frame) current.recycle()
    }
}

private fun resample(source: Bitmap, from: Rect, width: Int): Bitmap {
    val height = maxOf(1, (from.height().toDouble() * width / from.width()).roundToInt())
    val scaled = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    Canvas(scaled).drawBitmap(source, from, Rect(0, 0, width, height), resamplePaint)
    return scaled
}
