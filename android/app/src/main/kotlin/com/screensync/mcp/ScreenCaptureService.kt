package com.screensync.mcp

import android.app.Activity
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean

class ScreenCaptureService : Service() {
    /// Told whenever a projection session becomes live or ends. Fed to Dart by
    /// [ProjectionStateStream]; may be called from any thread.
    fun interface StateListener {
        fun onProjectionStateChanged(active: Boolean)
    }

    companion object {
        private const val ACTION_START = "com.screensync.mcp.START_PROJECTION"
        private const val ACTION_STOP = "com.screensync.mcp.STOP_PROJECTION"
        private const val EXTRA_RESULT_CODE = "resultCode"
        private const val EXTRA_RESULT_DATA = "resultData"
        private const val TAG = "ScreenSync"

        // ── Rich notification action intents ──
        const val ACTION_SNAP = "com.screensync.mcp.SNAP"
        const val ACTION_TRIGGER_MCP = "com.screensync.mcp.TRIGGER_MCP"
        const val ACTION_PAUSE = "com.screensync.mcp.PAUSE"

        private const val FRAME_TIMEOUT_MS = 4_000L

        @Volatile
        private var instance: ScreenCaptureService? = null

        @Volatile
        var stateListener: StateListener? = null

        // Pause belongs to the process, not to a capture session. It used to be a field
        // on the service that the app's switch changed with a broadcast: with no session
        // running nobody received it, and with one the switch read the state back before
        // the asynchronous broadcast landed. Either way the switch snapped back to off.
        @Volatile
        private var paused = false

        /// Applies at once and survives a session restart; the notification follows.
        fun setPausedState(value: Boolean) {
            paused = value
            instance?.updateNotification()
        }

        fun start(context: Context, resultCode: Int, resultData: Intent) {
            val intent = Intent(context, ScreenCaptureService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_RESULT_CODE, resultCode)
                putExtra(EXTRA_RESULT_DATA, resultData)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, ScreenCaptureService::class.java))
        }

        fun isReady(): Boolean = instance?.isProjectionReady() == true

        fun isPausedState(): Boolean = paused

        fun capture(callback: (Result<ByteArray>) -> Unit) {
            val service = instance
            if (service == null) {
                callback(Result.failure(IllegalStateException("Screen capture session is not active.")))
                return
            }
            service.captureFrame(callback)
        }
    }

    private lateinit var projectionManager: MediaProjectionManager
    private lateinit var workerThread: HandlerThread
    private lateinit var workerHandler: Handler
    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var captureWidth = 0
    private var captureHeight = 0
    private var captureDensityDpi = 0
    private var captureCallback: ((Result<ByteArray>) -> Unit)? = null
    private val framePending = AtomicBoolean(false)
    private var captureRetried = false
    private var promoteFailureLogged = false

    // ── Broadcast receiver for notification quick-action buttons ──
    private val actionReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                ACTION_SNAP -> {
                    // Write a trigger file that the Dart bridge polls
                    writeTriggerFile(context, "SNAP", "snap")
                }
                ACTION_TRIGGER_MCP -> {
                    writeTriggerFile(context, "MCP", "mcp")
                }
                ACTION_PAUSE -> setPausedState(!paused)
            }
        }
    }

    /// The Dart bridge polls this file and dedupes by the EXACT payload string,
    /// so every tap must write a payload nobody has seen before. A constant
    /// payload made the second Snap tap look like a repeat and get ignored:
    /// "id" carries "<kind>:<epochMillis>" (e.g. "snap:1727712000000").
    private fun writeTriggerFile(context: Context?, type: String, kind: String) {
        try {
            // Must match Dart CaptureTriggerBridge._file(), which resolves to
            // getApplicationDocumentsDirectory(). path_provider_android maps
            // that to getDir("flutter", MODE_PRIVATE) = <data>/app_flutter,
            // NOT filesDir (<data>/files, that is getApplicationSupportDirectory).
            // Writing anywhere else means the Dart watcher never sees the tap.
            val dir = context?.getDir("flutter", Context.MODE_PRIVATE)?.path ?: return
            val id = "$kind:${System.currentTimeMillis()}"
            java.io.File(dir, "screensync_capture_trigger")
                .writeText("""{"type":"NOTIFICATION_SNAP","source":"$type","id":"$id"}""")
        } catch (e: Exception) {
            Log.w(TAG, "could not write the capture trigger file", e)
        }
    }

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            workerHandler.post {
                failPendingCapture("Screen capture permission was revoked.")
                releaseProjection(stopProjection = false)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        projectionManager = getSystemService(MediaProjectionManager::class.java)
        workerThread = HandlerThread("ScreenSyncCapture").apply { start() }
        workerHandler = Handler(workerThread.looper)
        CaptureNotification.ensureChannel(this)
        registerActionReceiver()
        instance = this
    }

    private fun registerActionReceiver() {
        val filter = IntentFilter().apply {
            addAction(ACTION_SNAP)
            addAction(ACTION_TRIGGER_MCP)
            addAction(ACTION_PAUSE)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(actionReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(actionReceiver, filter)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startProjection(intent)
            ACTION_STOP -> {
                releaseProjection(stopProjection = true)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        if (instance === this) instance = null
        try {
            unregisterReceiver(actionReceiver)
        } catch (e: Exception) {
            Log.w(TAG, "action receiver was not registered", e)
        }
        releaseProjection(stopProjection = true)
        // The service is gone: no session can be live, whatever released above.
        notifyProjectionState(false)
        workerThread.quitSafely()
        super.onDestroy()
    }

    private fun startProjection(intent: Intent) {
        if (!startCaptureForeground()) return
        if (mediaProjection != null) return

        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
        val resultData = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(EXTRA_RESULT_DATA)
        }

        if (resultCode != Activity.RESULT_OK || resultData == null) {
            Log.w(TAG, "projection start without a granted consent result (code=$resultCode)")
            stopSelf()
            return
        }

        try {
            val projection = projectionManager.getMediaProjection(resultCode, resultData)
            if (projection == null) {
                Log.w(TAG, "getMediaProjection returned null")
                stopSelf()
                return
            }
            projection.registerCallback(projectionCallback, workerHandler)
            mediaProjection = projection
            createCaptureDisplay()
            notifyProjectionState(isProjectionReady())
        } catch (e: SecurityException) {
            Log.e(TAG, "projection start was rejected", e)
            releaseProjection(stopProjection = true)
            stopSelf()
        }
    }

    /// Promotes the service to foreground. The system can refuse (missing
    /// foreground-service permission, background-start limits): that must end
    /// the service cleanly and leave a log line, not crash the process.
    private fun startCaptureForeground(): Boolean {
        return try {
            val notification = CaptureNotification.build(this, paused)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    CaptureNotification.NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
                )
            } else {
                startForeground(CaptureNotification.NOTIFICATION_ID, notification)
            }
            true
        } catch (e: Exception) {
            Log.e(TAG, "startForeground was refused", e)
            stopSelf()
            false
        }
    }

    private fun updateNotification() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(CaptureNotification.NOTIFICATION_ID, CaptureNotification.build(this, paused))
    }

    /// Tells the projection_state stream. Any thread; never throws.
    private fun notifyProjectionState(active: Boolean) {
        try {
            stateListener?.onProjectionStateChanged(active)
        } catch (e: Exception) {
            Log.w(TAG, "projection state listener failed", e)
        }
    }

    private fun createCaptureDisplay() {
        val metrics = currentDisplayMetrics()
        captureWidth = metrics.widthPixels
        captureHeight = metrics.heightPixels
        captureDensityDpi = metrics.densityDpi
        imageReader = createImageReader(captureWidth, captureHeight)

        virtualDisplay = mediaProjection?.createVirtualDisplay(
            "ScreenSyncCapture",
            captureWidth,
            captureHeight,
            captureDensityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader?.surface,
            null,
            workerHandler,
        )
        promoteCaptureSurface()
    }

    /**
     * Android 14+ only pushes frames to a virtual-display surface while it
     * is explicitly promoted; without this the ImageReader never fires and
     * every capture times out with "Timed out waiting for a screen frame."
     */
    private fun promoteCaptureSurface() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return
        val surface = imageReader?.surface ?: return
        try {
            // Surface#promote() is not in every compile SDK; reflect so the
            // call works at runtime on Android 14+ without build coupling.
            surface.javaClass.getMethod("promote").invoke(surface)
        } catch (e: Exception) {
            // Older/renamed API: capture still works pre-14. This runs on every
            // capture, so say it once instead of flooding logcat.
            if (!promoteFailureLogged) {
                promoteFailureLogged = true
                Log.w(TAG, "Surface.promote() unavailable; relying on default frame delivery", e)
            }
        }
    }

    private fun currentDisplayMetrics(): DisplayMetrics {
        val windowManager = getSystemService(WindowManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = windowManager.currentWindowMetrics.bounds
            return DisplayMetrics().apply {
                widthPixels = bounds.width()
                heightPixels = bounds.height()
                densityDpi = resources.displayMetrics.densityDpi
            }
        }
        return DisplayMetrics().apply {
            @Suppress("DEPRECATION")
            windowManager.defaultDisplay.getRealMetrics(this)
        }
    }

    private fun createImageReader(width: Int, height: Int): ImageReader =
        ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2).apply {
            setOnImageAvailableListener({ reader -> onImageAvailable(reader) }, workerHandler)
        }

    private fun resizeCaptureIfNeeded() {
        val metrics = currentDisplayMetrics()
        if (metrics.widthPixels == captureWidth && metrics.heightPixels == captureHeight) return

        val oldReader = imageReader
        val newReader = createImageReader(metrics.widthPixels, metrics.heightPixels)
        virtualDisplay?.resize(metrics.widthPixels, metrics.heightPixels, metrics.densityDpi)
        virtualDisplay?.surface = newReader.surface
        imageReader = newReader
        promoteCaptureSurface()
        captureWidth = metrics.widthPixels
        captureHeight = metrics.heightPixels
        captureDensityDpi = metrics.densityDpi
        oldReader?.setOnImageAvailableListener(null, null)
        oldReader?.close()
    }

    private fun isProjectionReady(): Boolean =
        mediaProjection != null && virtualDisplay != null && imageReader != null

    private fun captureFrame(callback: (Result<ByteArray>) -> Unit) {
        if (paused) {
            callback(Result.failure(IllegalStateException("Capture is paused. Resume it in the notification or in the app's Capture controls.")))
            return
        }
        workerHandler.post {
            if (!isProjectionReady()) {
                callback(Result.failure(IllegalStateException("Screen capture session is not ready.")))
                return@post
            }
            resizeCaptureIfNeeded()
            promoteCaptureSurface()
            if (!framePending.compareAndSet(false, true)) {
                callback(Result.failure(IllegalStateException("A screen capture is already in progress.")))
                return@post
            }

            imageReader?.acquireLatestImage()?.close()
            captureCallback = callback
            captureRetried = false
            armFrameTimeout()
        }
    }

    /**
     * Some devices (notably Android 13) don't push a frame until the
     * virtual-display surface is re-primed — retry once before failing.
     */
    private fun armFrameTimeout() {
        workerHandler.postDelayed({
            if (!framePending.get()) return@postDelayed
            if (!captureRetried) {
                captureRetried = true
                imageReader?.acquireLatestImage()?.close()
                promoteCaptureSurface()
                armFrameTimeout()
                return@postDelayed
            }
            if (framePending.compareAndSet(true, false)) {
                val pending = captureCallback
                captureCallback = null
                pending?.invoke(Result.failure(IllegalStateException("Timed out waiting for a screen frame.")))
            }
        }, FRAME_TIMEOUT_MS)
    }

    private fun onImageAvailable(reader: ImageReader) {
        val image = reader.acquireLatestImage() ?: return
        if (!framePending.compareAndSet(true, false)) {
            image.close()
            return
        }

        val callback = captureCallback
        captureCallback = null
        try {
            callback?.invoke(Result.success(imageToPng(image)))
        } catch (error: Throwable) {
            callback?.invoke(Result.failure(error))
        } finally {
            image.close()
        }
    }

    private fun imageToPng(image: Image): ByteArray {
        val plane = image.planes.first()
        val buffer = plane.buffer
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * image.width
        val paddedWidth = image.width + rowPadding / pixelStride

        val paddedBitmap = Bitmap.createBitmap(paddedWidth, image.height, Bitmap.Config.ARGB_8888)
        paddedBitmap.copyPixelsFromBuffer(buffer)
        val croppedBitmap = Bitmap.createBitmap(paddedBitmap, 0, 0, image.width, image.height)

        return ByteArrayOutputStream().use { output ->
            if (!croppedBitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) {
                throw IllegalStateException("Could not encode the captured frame as PNG.")
            }
            croppedBitmap.recycle()
            paddedBitmap.recycle()
            output.toByteArray()
        }
    }

    private fun failPendingCapture(message: String) {
        if (framePending.compareAndSet(true, false)) {
            val pending = captureCallback
            captureCallback = null
            pending?.invoke(Result.failure(IllegalStateException(message)))
        }
    }

    private fun releaseProjection(stopProjection: Boolean) {
        failPendingCapture("Screen capture session stopped.")
        imageReader?.setOnImageAvailableListener(null, null)
        virtualDisplay?.release()
        virtualDisplay = null
        imageReader?.close()
        imageReader = null

        val projection = mediaProjection
        mediaProjection = null
        if (projection != null) {
            projection.unregisterCallback(projectionCallback)
            if (stopProjection) projection.stop()
        }
        // Every way a session ends (revoked, stopped, service torn down) lands here.
        notifyProjectionState(false)
    }
}
