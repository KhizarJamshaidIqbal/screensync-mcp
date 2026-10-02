package com.screensync.mcp

import android.graphics.Bitmap
import android.graphics.Rect
import kotlin.math.roundToInt

/**
 * What a capture should hand back, as Dart asks for it on the `captureScreen` call.
 *
 * Kotlin makes the final picture (crop, scale, encode), so a JPEG preset no longer
 * goes through a full-resolution PNG here and a decode and second encode in Dart.
 * With no arguments the request is a native-resolution PNG, which is what the
 * `inspection` preset wants.
 *
 * A data class on purpose: it is the key of [LatestFrame]'s per-frame encode cache,
 * so one held frame can answer a PNG request and a JPEG request without re-encoding
 * either.
 */
data class CaptureRequest(
    val format: Format = Format.PNG,
    /** Widest the picture may be; null keeps the (cropped) frame's own width. Never upscales. */
    val maxWidth: Int? = null,
    /** 1..100, used for [Format.JPEG] only. */
    val jpegQuality: Int = DEFAULT_JPEG_QUALITY,
    /** The part of the frame to keep; null keeps all of it. */
    val crop: Crop? = null,
) {
    enum class Format(val wire: String, val mime: String, val compressFormat: Bitmap.CompressFormat) {
        PNG("png", "image/png", Bitmap.CompressFormat.PNG),
        JPEG("jpeg", "image/jpeg", Bitmap.CompressFormat.JPEG),
    }

    /** A region as fractions (0..1) of the frame's width and height. */
    data class Crop(val x: Double, val y: Double, val w: Double, val h: Double) {
        /**
         * The pixel region of a [width] x [height] frame. Same arithmetic as Dart's
         * `CapturePipeline.cropNormalized` (clamp to the frame, at least 8 px), but
         * always inside the frame and at least 1 px, so it is safe to read from.
         */
        fun toRect(width: Int, height: Int): Rect {
            val left = (x.coerceIn(0.0, 1.0) * width).roundToInt().coerceIn(0, width - 1)
            val top = (y.coerceIn(0.0, 1.0) * height).roundToInt().coerceIn(0, height - 1)
            val right = ((x + w).coerceIn(0.0, 1.0) * width).roundToInt()
            val bottom = ((y + h).coerceIn(0.0, 1.0) * height).roundToInt()
            return Rect(
                left,
                top,
                maxOf(right, left + MIN_CROP_PX).coerceIn(left + 1, width),
                maxOf(bottom, top + MIN_CROP_PX).coerceIn(top + 1, height),
            )
        }
    }

    companion object {
        const val DEFAULT_JPEG_QUALITY = 74
        private const val MIN_CROP_PX = 8

        /** Reads the method-call arguments; anything missing or malformed falls back to the default. */
        fun fromArguments(arguments: Any?): CaptureRequest {
            val map = arguments as? Map<*, *> ?: return CaptureRequest()
            val format = Format.values().firstOrNull { it.wire == map["format"] } ?: Format.PNG
            val quality = (map["jpegQuality"] as? Number)?.toInt() ?: DEFAULT_JPEG_QUALITY
            return CaptureRequest(
                format = format,
                maxWidth = (map["maxWidth"] as? Number)?.toInt()?.takeIf { it > 0 },
                jpegQuality = quality.coerceIn(1, 100),
                crop = (map["crop"] as? Map<*, *>)?.let(::cropFrom),
            )
        }

        private fun cropFrom(map: Map<*, *>): Crop? {
            val x = (map["x"] as? Number)?.toDouble() ?: return null
            val y = (map["y"] as? Number)?.toDouble() ?: return null
            val w = (map["w"] as? Number)?.toDouble() ?: return null
            val h = (map["h"] as? Number)?.toDouble() ?: return null
            return Crop(x, y, w, h)
        }
    }
}

/** A finished capture: the encoded picture and what it is. */
class EncodedCapture(
    val bytes: ByteArray,
    val format: CaptureRequest.Format,
    val width: Int,
    val height: Int,
) {
    /** The reply Dart reads on the `captureScreen` call. */
    fun toChannelReply(): Map<String, Any> = mapOf(
        "bytes" to bytes,
        "format" to format.wire,
        "width" to width,
        "height" to height,
    )
}
