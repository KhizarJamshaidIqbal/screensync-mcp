package com.screensync.mcp

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings

/// Brand detection and the vendor-specific settings pages the Permission Doctor
/// sends the owner to (auto-start, background limits, developer options).
object VendorSettings {

    fun detectBrand(): String {
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

    /// Opens the Developer Options page so the user can enable the toggle
    /// that lets ADB inject input events (tap/swipe/type) — required for the
    /// AI gesture-control loop. On Xiaomi/MIUI/HyperOS this permission is the
    /// "USB debugging (Security settings)" toggle, which lives on a dedicated
    /// page; we try that exact page first, then Developer Options, then the
    /// generic developer settings action, and finally this app's detail page.
    fun openDeveloperSettings(activity: Activity): Boolean {
        val candidates = mutableListOf<Intent>()

        if (detectBrand() == "xiaomi") {
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

        return startFirst(activity, candidates) || openAppDetails(activity)
    }

    fun openVendorBackgroundSettings(activity: Activity): Boolean {
        val intents = when (detectBrand()) {
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

        // Fall back to generic app settings
        return startFirst(activity, intents) || openAppDetails(activity)
    }

    /// Starts the first intent the device can resolve; false when none opened.
    private fun startFirst(activity: Activity, intents: List<Intent>): Boolean {
        for (intent in intents) {
            try {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.startActivity(intent)
                return true
            } catch (_: Exception) { /* try next */ }
        }
        return false
    }

    /// This app's detail page (still one tap from the permission toggles).
    private fun openAppDetails(activity: Activity): Boolean {
        return try {
            activity.startActivity(
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:${activity.packageName}")
                ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            )
            true
        } catch (_: Exception) { false }
    }
}
