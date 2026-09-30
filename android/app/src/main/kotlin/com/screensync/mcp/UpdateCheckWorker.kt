package com.screensync.mcp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.install.model.UpdateAvailability
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/// The background half of the update channel for Play-installed builds.
///
/// A Play install can only be updated by Play, and asking Play does not need the
/// desktop hub or the Flutter engine - so this WorkManager job runs whether or
/// not the app has been opened, and raises a local notification when a newer
/// build exists. Tapping it opens the app, where the update gate starts Play's
/// own full-screen (immediate) update flow.
class UpdateCheckWorker(appContext: Context, params: WorkerParameters) :
    Worker(appContext, params) {

    companion object {
        // The "-v2" job carries the network constraint. KEEP never rewrites an
        // existing job, so phones that already scheduled the old battery-only
        // job would keep it forever: it is cancelled and replaced once.
        private const val WORK_NAME = "screensync-play-update-check-v2"
        private const val LEGACY_WORK_NAME = "screensync-play-update-check"
        private const val CHANNEL_ID = "screensync_app_update"
        private const val NOTIFICATION_ID = 4203
        private const val TAG = "ScreenSync"

        // Dart's shared_preferences plugin keeps "autoUpdateCheck" in the
        // "FlutterSharedPreferences" file under the key "flutter.autoUpdateCheck".
        private const val PREFS_FILE = "FlutterSharedPreferences"
        private const val PREF_AUTO_UPDATE_CHECK = "flutter.autoUpdateCheck"

        /// Idempotent: KEEP leaves an existing job alone, so calling this on
        /// every app start does not reset the schedule or pile up duplicates.
        fun schedule(context: Context) {
            try {
                val request =
                    PeriodicWorkRequestBuilder<UpdateCheckWorker>(12, TimeUnit.HOURS)
                        .setConstraints(
                            Constraints.Builder()
                                // Asking Play with no network can only fail.
                                .setRequiredNetworkType(NetworkType.CONNECTED)
                                .setRequiresBatteryNotLow(true)
                                .build()
                        )
                        .build()
                val manager = WorkManager.getInstance(context)
                manager.cancelUniqueWork(LEGACY_WORK_NAME)
                manager.enqueueUniquePeriodicWork(
                    WORK_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    request,
                )
            } catch (e: Exception) {
                // WorkManager unavailable (rare) - the in-app gate still covers it.
                Log.w(TAG, "could not schedule the Play update check", e)
            }
        }

        /// The owner's "check for updates automatically" switch (default: on).
        /// Anything unreadable counts as on: a broken prefs file must not
        /// silently disable updates.
        private fun autoUpdateCheckEnabled(context: Context): Boolean {
            return try {
                context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
                    .getBoolean(PREF_AUTO_UPDATE_CHECK, true)
            } catch (e: Exception) {
                Log.w(TAG, "could not read the auto-update preference", e)
                true
            }
        }

        fun notifyUpdateAvailable(context: Context, availableVersionCode: Int) {
            val nm = context.getSystemService(NotificationManager::class.java) ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                    nm.createNotificationChannel(
                        NotificationChannel(
                            CHANNEL_ID,
                            "App updates",
                            NotificationManager.IMPORTANCE_HIGH,
                        ).apply { description = "New ScreenSync builds on Google Play" }
                    )
                }
            }
            val openApp = PendingIntent.getActivity(
                context, 11,
                context.packageManager.getLaunchIntentForPackage(context.packageName)
                    ?: Intent(context, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_screensync)
                .setContentTitle("ScreenSync update available")
                .setContentText("Build $availableVersionCode is ready. Tap to update now.")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                // Same notification id every run: refresh it, never re-alert.
                .setOnlyAlertOnce(true)
                .setAutoCancel(true)
                .setContentIntent(openApp)
                .build()
            nm.notify(NOTIFICATION_ID, notification)
        }
    }

    /// A sideloaded build shares the package name with the Play release but not
    /// its signing certificate - the store reports "certificate mismatch" for it.
    /// Asking Play about such a build and then notifying the owner would raise an
    /// update notice that can never be satisfied, so nothing is asked at all.
    private fun playOwnsThisBuild(): Boolean {
        return try {
            val pm = applicationContext.packageManager
            val installer = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                pm.getInstallSourceInfo(applicationContext.packageName)
                    .installingPackageName
            } else {
                @Suppress("DEPRECATION")
                pm.getInstallerPackageName(applicationContext.packageName)
            }
            installer == "com.android.vending"
        } catch (e: Exception) {
            Log.w(TAG, "could not read the install source", e)
            false
        }
    }

    override fun doWork(): Result {
        // The owner switched automatic checks off: no request, no notification.
        if (!autoUpdateCheckEnabled(applicationContext)) return Result.success()
        if (!playOwnsThisBuild()) return Result.success()
        return try {
            val manager = AppUpdateManagerFactory.create(applicationContext)
            // Every read of `appUpdateInfo` issues a NEW request, so ask exactly
            // once and read the result off that same task.
            val task = manager.appUpdateInfo
            // Task callbacks land on the main thread while this worker runs on a
            // background thread, so wait for the answer: returning immediately
            // would let WorkManager stop us before it arrives.
            val done = CountDownLatch(1)
            task.addOnCompleteListener { done.countDown() }
            if (!done.await(30, TimeUnit.SECONDS)) {
                Log.w(TAG, "Play update check timed out")
                return Result.success()
            }
            // `task.result` throws unless the task succeeded.
            if (!task.isSuccessful) {
                Log.w(TAG, "Play update check failed", task.exception)
                return Result.success()
            }
            val info = task.result
            if (info != null &&
                info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
            ) {
                notifyUpdateAvailable(applicationContext, info.availableVersionCode())
            }
            Result.success()
        } catch (e: Exception) {
            // Play unavailable or the request blew up: nothing to report, but
            // leave a trace instead of a silent no-op.
            Log.w(TAG, "Play update check crashed", e)
            Result.success()
        }
    }
}
