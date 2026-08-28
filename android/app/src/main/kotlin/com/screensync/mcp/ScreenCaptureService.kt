package com.screensync.mcp

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
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
import android.view.WindowManager
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean

class ScreenCaptureService : Service() {
    companion object {
        private const val ACTION_START = "com.screensync.mcp.START_PROJECTION"
        private const val ACTION_STOP = "com.screensync.mcp.STOP_PROJECTION"
        private const val EXTRA_RESULT_CODE = "resultCode"
        private const val EXTRA_RESULT_DATA = "resultData"
        private const val NOTIFICATION_CHANNEL_ID = "screensync_capture"
        private const val NOTIFICATION_ID = 4201

        // ── Rich notification action intents ──
        const val ACTION_SNAP = "com.screensync.mcp.SNAP"
        const val ACTION_TRIGGER_MCP = "com.screensync.mcp.TRIGGER_MCP"
        const val ACTION_PAUSE = "com.screensync.mcp.PAUSE"

        private const val FRAME_TIMEOUT_MS = 4_000L

        @Volatile
        private var instance: ScreenCaptureService? = null

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

        fun isPausedState(): Boolean = instance?.isPaused == true

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
    private var isPaused = false

    // ── Broadcast receiver for notification quick-action buttons ──
    private val actionReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                ACTION_SNAP -> {
                    // Write a trigger file that the Dart bridge polls
                    writeTriggerFile(context, "SNAP")
                }
                ACTION_TRIGGER_MCP -> {
                    writeTriggerFile(context, "MCP")
                }
                ACTION_PAUSE -> {
                    isPaused = !isPaused
                    updateNotification()
                }
            }
        }
    }

    private fun writeTriggerFile(context: Context?, type: String) {
        try {
            // Must match Dart CaptureTriggerBridge._file(): both resolve to
            // <app files dir>/screensync_capture_trigger (path_provider
            // getApplicationDocumentsDirectory). cacheDir/code_cache differ
            // per engine, so filesDir is the one stable shared location.
            val dir = context?.filesDir?.path ?: return
            java.io.File(dir, "screensync_capture_trigger")
                .writeText("""{"type":"NOTIFICATION_SNAP","source":"$type"}""")
        } catch (_: Exception) {}
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
        createNotificationChannel()
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
        try { unregisterReceiver(actionReceiver) } catch (_: Exception) {}
        releaseProjection(stopProjection = true)
        workerThread.quitSafely()
        super.onDestroy()
    }

    private fun startProjection(intent: Intent) {
        startCaptureForeground()
        if (mediaProjection != null) return

        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
        val resultData = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(EXTRA_RESULT_DATA)
        }

        if (resultCode != Activity.RESULT_OK || resultData == null) {
            stopSelf()
            return
        }

        try {
            val projection = projectionManager.getMediaProjection(resultCode, resultData)
            if (projection == null) {
                stopSelf()
                return
            }
            projection.registerCallback(projectionCallback, workerHandler)
            mediaProjection = projection
            createCaptureDisplay()
        } catch (_: SecurityException) {
            releaseProjection(stopProjection = true)
            stopSelf()
        }
    }

    // ── Rich keep-alive notification with action buttons ──
    private fun buildNotification(paused: Boolean = false): Notification {
        val openAppIntent = PendingIntent.getActivity(
            this, 0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        fun actionIntent(action: String, requestCode: Int): PendingIntent =
            PendingIntent.getBroadcast(
                this, requestCode,
                Intent(action).setPackage(packageName),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

        return Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle(if (paused) "ScreenSync — paused" else "ScreenSync capture active")
            .setContentText(
                if (paused) "Tap ▶ to resume"
                else "Tap bubble · long-press = region select · shake = auto-capture"
            )
            .setContentIntent(openAppIntent)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setPriority(Notification.PRIORITY_LOW)
            .addAction(
                Notification.Action.Builder(
                    android.graphics.drawable.Icon.createWithResource(this, applicationInfo.icon),
                    "📸 Snap",
                    actionIntent(ACTION_SNAP, 1)
                ).build()
            )
            .addAction(
                Notification.Action.Builder(
                    android.graphics.drawable.Icon.createWithResource(this, applicationInfo.icon),
                    "⚡ MCP",
                    actionIntent(ACTION_TRIGGER_MCP, 2)
                ).build()
            )
            .addAction(
                Notification.Action.Builder(
                    android.graphics.drawable.Icon.createWithResource(this, applicationInfo.icon),
                    if (paused) "▶ Resume" else "⏸ Pause",
                    actionIntent(ACTION_PAUSE, 3)
                ).build()
            )
            .build()
    }

    private fun startCaptureForeground() {
        val notification = buildNotification(isPaused)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun updateNotification() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification(isPaused))
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
        } catch (_: Exception) {/* older/renamed API: capture still works pre-14 */}
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
        if (isPaused) {
            callback(Result.failure(IllegalStateException("Capture is paused. Tap ▶ in the notification to resume.")))
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
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Screen capture",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Shown while ScreenSync can capture the display"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }
}
