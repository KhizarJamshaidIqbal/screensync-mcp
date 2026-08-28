package com.screensync.mcp

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    companion object {
        private const val PROJ_CHANNEL = "com.screensync.mcp/media_projection"
        private const val DEVICE_CHANNEL = "com.screensync.mcp/device"
        private const val CAPTURE_PERMISSION_REQUEST = 7301
        private const val ALERT_CHANNEL_ID = "screensync_alert"
    }

    private lateinit var projectionManager: MediaProjectionManager
    private var pendingPermissionResult: MethodChannel.Result? = null

    // Track pending-snap bytes written by notification action receiver
    private val pendingSnaps = ArrayDeque<ByteArray>()

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        projectionManager = getSystemService(MediaProjectionManager::class.java)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        // ── MediaProjection channel ──
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, PROJ_CHANNEL)
            .setMethodCallHandler(::handleProjectionCall)

        // ── Device / Permission Doctor channel ──
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, DEVICE_CHANNEL)
            .setMethodCallHandler(::handleDeviceCall)
    }

    @Deprecated("Retained for FlutterActivity compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != CAPTURE_PERMISSION_REQUEST) return

        val pending = pendingPermissionResult
        pendingPermissionResult = null
        if (pending == null) return

        if (resultCode == Activity.RESULT_OK && data != null) {
            ScreenCaptureService.start(this, resultCode, data)
            pending.success(true)
        } else {
            pending.success(false)
        }
    }

    override fun onDestroy() {
        pendingPermissionResult?.error(
            "activity_destroyed",
            "The capture permission request was interrupted.",
            null,
        )
        pendingPermissionResult = null
        super.onDestroy()
    }

    // ── MediaProjection handlers ──

    private fun handleProjectionCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "prepareCapture" -> prepareCapture(result)
            "isCaptureReady" -> result.success(ScreenCaptureService.isReady())
            "captureScreen" -> captureScreen(result)
            "stopCapture" -> {
                ScreenCaptureService.stop(this)
                result.success(null)
            }
            "pauseCapture" -> {
                val paused = call.argument<Boolean>("paused") ?: true
                if (ScreenCaptureService.isPausedState() != paused) {
                    sendBroadcast(
                        Intent(ScreenCaptureService.ACTION_PAUSE).setPackage(packageName)
                    )
                }
                result.success(null)
            }
            "isPaused" -> result.success(ScreenCaptureService.isPausedState())
            else -> result.notImplemented()
        }
    }

    private fun prepareCapture(result: MethodChannel.Result) {
        if (ScreenCaptureService.isReady()) {
            result.success(true)
            return
        }
        if (pendingPermissionResult != null) {
            result.error(
                "permission_request_active",
                "A screen capture permission request is already open.",
                null,
            )
            return
        }
        pendingPermissionResult = result
        @Suppress("DEPRECATION")
        startActivityForResult(
            projectionManager.createScreenCaptureIntent(),
            CAPTURE_PERMISSION_REQUEST,
        )
    }

    private fun captureScreen(result: MethodChannel.Result) {
        ScreenCaptureService.capture { captureResult ->
            runOnUiThread {
                captureResult.fold(
                    onSuccess = { pngBytes -> result.success(pngBytes) },
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
            "deviceBrand" -> result.success(detectBrand())
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
            "openVendorBackgroundSettings" -> result.success(openVendorBackgroundSettings())
            "openDeveloperSettings" -> result.success(openDeveloperSettings())
            "bringAppToFront" -> result.success(bringAppToFront())
            "shareImage" -> {
                val path = call.argument<String>("path")
                if (path == null) {
                    result.success(false)
                } else {
                    result.success(shareImage(path))
                }
            }
            "pendingSnapCount" -> result.success(pendingSnaps.size)
            "drainPendingSnaps" -> {
                val drained = pendingSnaps.toList()
                pendingSnaps.clear()
                result.success(drained)
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
        val notification = Notification.Builder(this, ALERT_CHANNEL_ID)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent)
            .build()
        nm.notify(4202, notification)
    }

    private fun shareImage(path: String): Boolean {
        return try {
            val file = File(path)
            if (!file.exists()) return false
            val uri: Uri = FileProvider.getUriForFile(
                this, "${packageName}.fileprovider", file
            )
            val share = Intent(Intent.ACTION_SEND).apply {
                type = "image/*"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(Intent.createChooser(share, "Share capture"))
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun detectBrand(): String {
        val manufacturer = Build.MANUFACTURER.lowercase()
        return when {
            manufacturer.contains("xiaomi") || manufacturer.contains("redmi") || manufacturer.contains("poco") -> "xiaomi"
            manufacturer.contains("samsung") -> "samsung"
            manufacturer.contains("huawei") || manufacturer.contains("honor") -> "huawei"
            manufacturer.contains("oppo") || manufacturer.contains("realme") || manufacturer.contains("oneplus") -> "oppo"
            manufacturer.contains("vivo") || manufacturer.contains("iqoo") -> "vivo"
            else -> "stock"
        }
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

    /// Opens the Developer Options page so the user can enable the toggle
    /// that lets ADB inject input events (tap/swipe/type) — required for the
    /// AI gesture-control loop. On Xiaomi/MIUI/HyperOS this permission is the
    /// "USB debugging (Security settings)" toggle, which lives on a dedicated
    /// page; we try that exact page first, then Developer Options, then the
    /// generic developer settings action, and finally this app's detail page.
    private fun openDeveloperSettings(): Boolean {
        val brand = detectBrand()
        val candidates = mutableListOf<Intent>()

        if (brand == "xiaomi") {
            // MIUI / HyperOS dedicated "USB debugging (Security settings)" screen.
            candidates.add(
                Intent().setComponent(
                    ComponentName(
                        "com.android.settings",
                        "com.android.settings.Settings\$DevelopmentSettingsDashboardActivity"
                    )
                )
            )
            candidates.add(
                Intent().setComponent(
                    ComponentName(
                        "com.miui.securitycenter",
                        "com.miui.permcenter.settings.SecuritySettingsActivity"
                    )
                )
            )
        }

        // Standard AOSP Developer Options page.
        candidates.add(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS))

        for (intent in candidates) {
            try {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(intent)
                return true
            } catch (_: Exception) { /* try next */ }
        }

        // Fall back to this app's detail page (still one tap from settings).
        return try {
            startActivity(
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:$packageName")
                ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            )
            true
        } catch (_: Exception) { false }
    }

    private fun openVendorBackgroundSettings(): Boolean {
        val brand = detectBrand()
        val intents = when (brand) {
            "xiaomi" -> listOf(
                // MIUI / HyperOS auto-start
                Intent().setComponent(ComponentName(
                    "com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity"
                )),
                // HyperOS 2 path
                Intent().setComponent(ComponentName(
                    "com.miui.securitycenter",
                    "com.miui.powercenter.PowerManagerActivity"
                ))
            )
            "samsung" -> listOf(
                Intent().setComponent(ComponentName(
                    "com.samsung.android.lool",
                    "com.samsung.android.sm.battery.ui.BatteryActivity"
                ))
            )
            "huawei" -> listOf(
                Intent().setComponent(ComponentName(
                    "com.huawei.systemmanager",
                    "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"
                ))
            )
            "oppo" -> listOf(
                Intent().setComponent(ComponentName(
                    "com.coloros.safecenter",
                    "com.coloros.safecenter.permission.startup.StartupAppListActivity"
                ))
            )
            "vivo" -> listOf(
                Intent().setComponent(ComponentName(
                    "com.vivo.permissionmanager",
                    "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"
                ))
            )
            else -> emptyList()
        }

        for (intent in intents) {
            try {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(intent)
                return true
            } catch (_: Exception) { /* try next */ }
        }
        // Fall back to generic app settings
        return try {
            startActivity(
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:$packageName"))
                    .apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            )
            true
        } catch (_: Exception) { false }
    }
}
