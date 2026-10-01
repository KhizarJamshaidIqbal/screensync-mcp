package com.screensync.mcp

import android.app.Activity
import android.util.Log
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.install.model.ActivityResult
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability
import io.flutter.plugin.common.MethodChannel

/// Play In-App Updates for a store-installed build (the "playUpdateInfo" and
/// "startPlayUpdate" MethodChannel calls). Owns the one pending update flow and
/// the activity result that completes it.
class PlayUpdateHelper(private val activity: Activity) {
    companion object {
        const val REQUEST_CODE = 7402
        private const val TAG = "ScreenSync"
    }

    private var pending: MethodChannel.Result? = null

    /// Asks Play whether a newer build exists for this install.
    ///
    /// An empty result (null) means Play could not be asked - a sideloaded build
    /// has no store to talk to - and must never be read as "up to date".
    ///
    /// "updateAvailability" is the RAW Play integer (1 = none, 2 = available,
    /// 3 = a developer-triggered update is already in progress and can be
    /// resumed), so Dart can tell those apart.
    fun info(result: MethodChannel.Result) {
        val manager = manager()
        if (manager == null) {
            result.success(null)
            return
        }
        manager.appUpdateInfo
            .addOnSuccessListener { info ->
                result.success(
                    mapOf(
                        "availableVersionCode" to info.availableVersionCode(),
                        "updateAvailability" to info.updateAvailability(),
                        "immediateAllowed" to
                            info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE),
                        "flexibleAllowed" to
                            info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE),
                        "installStatus" to info.installStatus(),
                        "packageName" to info.packageName(),
                    )
                )
            }
            .addOnFailureListener { e ->
                Log.w(TAG, "Play update info request failed", e)
                result.success(null)
            }
    }

    /// Opens Play's own update UI. IMMEDIATE is the full-screen flow the owner
    /// asked for: it cannot be dismissed and only ends by installing. Play does
    /// the download, the signature check and the install, so this app never
    /// handles the package itself - which is also why it is the only legal route
    /// for a store-installed build.
    ///
    /// An update Play already started (availability 3) is resumed the same way.
    fun start(type: String, result: MethodChannel.Result) {
        val manager = manager()
        if (manager == null) {
            result.success("unavailable")
            return
        }
        if (pending != null) {
            result.error(
                "update_flow_active",
                "An update flow is already open.",
                null,
            )
            return
        }
        val updateType =
            if (type == "flexible") AppUpdateType.FLEXIBLE else AppUpdateType.IMMEDIATE
        manager.appUpdateInfo
            .addOnSuccessListener { info ->
                val availability = info.updateAvailability()
                val offerable =
                    (availability == UpdateAvailability.UPDATE_AVAILABLE ||
                        availability ==
                        UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS) &&
                        info.isUpdateTypeAllowed(updateType)
                if (!offerable) {
                    result.success("unavailable")
                    return@addOnSuccessListener
                }
                pending = result
                try {
                    val started = manager.startUpdateFlowForResult(
                        info,
                        updateType,
                        activity,
                        REQUEST_CODE,
                    )
                    if (!started) {
                        // Play refused to open the flow, so no activity result
                        // will ever arrive: release the caller instead of
                        // leaving it to time out.
                        pending = null
                        result.success("unavailable")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Play update flow failed to start", e)
                    pending = null
                    result.error("update_flow_failed", e.message, null)
                }
            }
            .addOnFailureListener { e ->
                Log.w(TAG, "Play update info request failed", e)
                result.success("unavailable")
            }
    }

    /// Completes the pending flow. Returns true when [requestCode] was ours.
    fun onActivityResult(requestCode: Int, resultCode: Int): Boolean {
        if (requestCode != REQUEST_CODE) return false
        val result = pending
        pending = null
        result?.success(
            when (resultCode) {
                Activity.RESULT_OK -> "installed"
                Activity.RESULT_CANCELED -> "canceled"
                ActivityResult.RESULT_IN_APP_UPDATE_FAILED -> "failed"
                else -> "failed"
            }
        )
        return true
    }

    /// The activity is going away: no result can arrive any more.
    fun cancelPending() {
        pending?.error(
            "activity_destroyed",
            "The Play update flow was interrupted.",
            null,
        )
        pending = null
    }

    /// Play Core needs Play services and a store install; on a sideloaded build
    /// every call must degrade to a no-op rather than crash.
    private fun manager(): AppUpdateManager? = try {
        AppUpdateManagerFactory.create(activity)
    } catch (e: Exception) {
        Log.w(TAG, "Play update manager unavailable", e)
        null
    }
}
