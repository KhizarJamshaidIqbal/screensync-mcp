package com.screensync.mcp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/// Flutter host activity: wires the platform channels and delegates the real
/// work to small single-purpose classes in this package.
///   ProjectionPermission   MediaProjection consent dialog + its 60 s timeout
///   ProjectionStateStream  "projection_state" EventChannel
///   UpdateInstaller        hub OTA: APK -> system installer
///   PlayUpdateHelper       Play In-App Updates
///   VendorSettings         brand detection + vendor settings pages
///   FileSharer             share sheet for frames + the diagnostics report
class MainActivity : FlutterActivity() {
    companion object {
        private const val PROJ_CHANNEL = "com.screensync.mcp/media_projection"
        private const val DEVICE_CHANNEL = "com.screensync.mcp/device"
        private const val ALERT_CHANNEL_ID = "screensync_alert"
    }

    // Constructors only store the activity; they touch no system service, so
    // creating them as properties is safe before the base context is attached
    // (configureFlutterEngine runs inside super.onCreate).
    private val projectionPermission = ProjectionPermission(this)
    private val projectionState = ProjectionStateStream()
    private val playUpdate = PlayUpdateHelper(this)

    // Track pending-snap bytes written by notification action receiver
    private val pendingSnaps = ArrayDeque<ByteArray>()

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        // Ask Play for new builds periodically, even when the app is closed.
        UpdateCheckWorker.schedule(this)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val messenger = flutterEngine.dartExecutor.binaryMessenger

        // ── MediaProjection channel ──
        MethodChannel(messenger, PROJ_CHANNEL)
            .setMethodCallHandler(::handleProjectionCall)

        // ── Live projection state (true while a capture session works) ──
        projectionState.attach(messenger)

        // ── Device / Permission Doctor channel ──
        MethodChannel(messenger, DEVICE_CHANNEL)
            .setMethodCallHandler(::handleDeviceCall)
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        projectionState.detach()
        super.cleanUpFlutterEngine(flutterEngine)
    }

    @Deprecated("Retained for FlutterActivity compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (playUpdate.onActivityResult(requestCode, resultCode)) return
        projectionPermission.onActivityResult(requestCode, resultCode, data)
    }

    override fun onDestroy() {
        projectionPermission.cancelPending()
        playUpdate.cancelPending()
        super.onDestroy()
    }

    // ── MediaProjection handlers ──

    private fun handleProjectionCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "prepareCapture" -> projectionPermission.prepare(result)
            "isCaptureReady" -> result.success(ScreenCaptureService.isReady())
            "captureScreen" -> captureScreen(call, result)
            "stopCapture" -> {
                ScreenCaptureService.stop(this)
                result.success(null)
            }
            "pauseCapture" -> {
                ScreenCaptureService.setPausedState(call.argument<Boolean>("paused") ?: true)
                result.success(ScreenCaptureService.isPausedState())
            }
            "isPaused" -> result.success(ScreenCaptureService.isPausedState())
            else -> result.notImplemented()
        }
    }

    /// Replies with the final picture (see [CaptureRequest]); a call without arguments
    /// still gets a native-resolution PNG.
    private fun captureScreen(call: MethodCall, result: MethodChannel.Result) {
        ScreenCaptureService.capture(CaptureRequest.fromArguments(call.arguments)) { captureResult ->
            runOnUiThread {
                captureResult.fold(
                    onSuccess = { picture -> result.success(picture.toChannelReply()) },
                    onFailure = { error ->
                        result.error(
                            "capture_failed",
                            error.message ?: "Screen capture failed.",
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                                "Android ${Build.VERSION.RELEASE}"
                            } else null,
                        )
                    },
                )
            }
        }
    }

    // ── Device / Permission Doctor handlers ──

    private fun handleDeviceCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "deviceBrand" -> result.success(VendorSettings.detectBrand())
            "batteryWhitelisted" -> result.success(isBatteryWhitelisted())
            "notificationsGranted" -> {
                val nm = getSystemService(NotificationManager::class.java)
                result.success(nm != null && nm.areNotificationsEnabled())
            }
            "requestPostNotifications" -> {
                requestPostNotifications()
                result.success(true)
            }
            "openOverlaySettings" -> {
                openOverlaySettings()
                result.success(true)
            }
            "requestBatteryWhitelist" -> {
                requestBatteryWhitelist()
                result.success(true)
            }
            "openVendorBackgroundSettings" ->
                result.success(VendorSettings.openVendorBackgroundSettings(this))
            "openDeveloperSettings" ->
                result.success(VendorSettings.openDeveloperSettings(this))
            "bringAppToFront" -> result.success(bringAppToFront())
            "shareImage" -> result.success(
                call.argument<String>("path")?.let {
                    FileSharer.share(this, it, "image/*", "Share capture")
                } ?: false
            )
            "shareFile" -> result.success(
                call.argument<String>("path")?.let {
                    FileSharer.share(
                        this,
                        it,
                        call.argument<String>("mimeType") ?: "application/octet-stream",
                        call.argument<String>("title") ?: "Share",
                        call.argument<String>("subject"),
                    )
                } ?: false
            )
            "pendingSnapCount" -> result.success(pendingSnaps.size)
            "drainPendingSnaps" -> {
                val drained = pendingSnaps.toList()
                pendingSnaps.clear()
                result.success(drained)
            }
            "installerPackage" -> result.success(installerPackage())
            "playUpdateInfo" -> playUpdate.info(result)
            "startPlayUpdate" -> playUpdate.start(
                call.argument<String>("type") ?: "immediate",
                result,
            )
            "versionInfo" -> result.success(versionInfo())
            "installApk" -> {
                // "started" | "needs_permission" | "error:<message>"
                val apkPath = call.argument<String>("path")
                result.success(
                    if (apkPath == null) "error:missing path"
                    else UpdateInstaller.install(this, apkPath)
                )
            }
            "postNotification" -> {
                val title = call.argument<String>("title") ?: "ScreenSync"
                val body = call.argument<String>("body") ?: ""
                postAlertNotification(title, body)
                result.success(true)
            }
            else -> result.notImplemented()
        }
    }

    /// Reorders the existing ScreenSync task to the foreground so the
    /// full-screen region editor becomes visible after a bubble long-press
    /// (the long-press fires while another app is in front).
    private fun bringAppToFront(): Boolean {
        return try {
            val intent = packageManager.getLaunchIntentForPackage(packageName)
                ?.apply {
                    addFlags(
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                            Intent.FLAG_ACTIVITY_NEW_TASK or
                            Intent.FLAG_ACTIVITY_SINGLE_TOP
                    )
                } ?: return false
            startActivity(intent)
            true
        } catch (_: Exception) {
            false
        }
    }

    /// Who installed this build. "com.android.vending" means the Play Store
    /// owns updates for it: a self-downloaded APK can never replace a Play build
    /// (different signing key) and Play policy forbids the attempt.
    private fun installerPackage(): String {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                packageManager.getInstallSourceInfo(packageName).installingPackageName ?: ""
            } else {
                @Suppress("DEPRECATION")
                packageManager.getInstallerPackageName(packageName) ?: ""
            }
        } catch (_: Exception) {
            ""
        }
    }

    /// Installed app version, read natively so no extra plugin is needed.
    private fun versionInfo(): Map<String, Any> {
        return try {
            @Suppress("DEPRECATION")
            val info = packageManager.getPackageInfo(packageName, 0)
            val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                info.longVersionCode
            } else {
                @Suppress("DEPRECATION") info.versionCode.toLong()
            }
            mapOf("versionName" to (info.versionName ?: "0.0.0"), "versionCode" to code)
        } catch (_: Exception) {
            mapOf("versionName" to "0.0.0", "versionCode" to 0L)
        }
    }

    private fun postAlertNotification(title: String, body: String) {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (nm.getNotificationChannel(ALERT_CHANNEL_ID) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(
                        ALERT_CHANNEL_ID,
                        "AI updates",
                        NotificationManager.IMPORTANCE_DEFAULT,
                    ).apply { description = "Live updates from the desktop hub" }
                )
            }
        }
        val openAppIntent = PendingIntent.getActivity(
            this, 10,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, ALERT_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_screensync)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent)
            .build()
        nm.notify(4202, notification)
    }

    private fun isBatteryWhitelisted(): Boolean {
        val pm = getSystemService(PowerManager::class.java)
        return pm.isIgnoringBatteryOptimizations(packageName)
    }

    private fun requestPostNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 9001)
        }
    }

    private fun openOverlaySettings() {
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:$packageName")
        ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
        startActivity(intent)
    }

    private fun requestBatteryWhitelist() {
        val intent = Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:$packageName")
        ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
        try {
            startActivity(intent)
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }
}
