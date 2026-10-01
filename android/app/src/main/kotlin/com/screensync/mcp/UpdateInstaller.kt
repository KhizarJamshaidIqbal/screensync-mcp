package com.screensync.mcp

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File

/// Hands a downloaded APK to the system package installer (hub OTA path).
///
/// The result is the value of the "installApk" MethodChannel call:
///   "started"            the installer screen really opened
///   "needs_permission"   "Install unknown apps" is not granted to ScreenSync,
///                        or this build does not declare REQUEST_INSTALL_PACKAGES
///                        (the "play" flavor); nothing was installed
///   "error:<message>"    anything else that went wrong
///
/// It never claims success it cannot prove: Android silently cancels an install
/// request from an app without the permission, so the old "always true" answer
/// made the UI announce an installer that never appeared.
object UpdateInstaller {
    private const val TAG = "ScreenSync"
    private const val APK_MIME = "application/vnd.android.package-archive"
    private const val MAX_MESSAGE = 120

    fun install(activity: Activity, path: String): String {
        return try {
            val file = File(path)
            if (!file.exists()) return "error:APK file not found"

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (!declaresInstallPermission(activity)) {
                    // Store build: there is no settings page that could help.
                    Log.w(TAG, "installApk: REQUEST_INSTALL_PACKAGES is not declared by this build")
                    return "needs_permission"
                }
                if (!activity.packageManager.canRequestPackageInstalls()) {
                    openUnknownSourcesSettings(activity)
                    return "needs_permission"
                }
            }

            val uri: Uri = FileProvider.getUriForFile(
                activity, "${activity.packageName}.fileprovider", file
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, APK_MIME)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(intent)
            "started"
        } catch (e: Exception) {
            Log.e(TAG, "installApk failed", e)
            "error:" + (e.message ?: e.javaClass.simpleName).take(MAX_MESSAGE)
        }
    }

    /// Takes the owner to the per-app "Install unknown apps" toggle.
    private fun openUnknownSourcesSettings(activity: Activity) {
        try {
            activity.startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}"),
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (e: Exception) {
            Log.w(TAG, "could not open the unknown-sources settings page", e)
        }
    }

    /// True when the installed manifest requests REQUEST_INSTALL_PACKAGES.
    private fun declaresInstallPermission(activity: Activity): Boolean {
        return try {
            val pm = activity.packageManager
            val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getPackageInfo(
                    activity.packageName,
                    PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()),
                )
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(activity.packageName, PackageManager.GET_PERMISSIONS)
            }
            info.requestedPermissions?.contains(
                android.Manifest.permission.REQUEST_INSTALL_PACKAGES
            ) == true
        } catch (e: Exception) {
            Log.w(TAG, "could not read requested permissions", e)
            false
        }
    }
}
