package com.screensync.mcp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
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
        private const val WORK_NAME = "screensync-play-update-check"
        private const val CHANNEL_ID = "screensync_app_update"
        private const val NOTIFICATION_ID = 4203

        /// Idempotent: KEEP leaves an existing job alone, so calling this on
        /// every app start does not reset the schedule or pile up duplicates.
        fun schedule(context: Context) {
            try {
                val request =
                    PeriodicWorkRequestBuilder<UpdateCheckWorker>(12, TimeUnit.HOURS)
                        .setConstraints(
                            Constraints.Builder()
                                .setRequiresBatteryNotLow(true)
                                .build()
                        )
                        .build()
                WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                    WORK_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    request,
                )
            } catch (_: Exception) {
                // WorkManager unavailable (rare) - the in-app gate still covers it.
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
        } catch (_: Exception) {
            false
        }
    }

    override fun doWork(): Result {
        if (!playOwnsThisBuild()) return Result.success()
        return try {
            val manager = AppUpdateManagerFactory.create(applicationContext)
            // Task callbacks land on the main thread while this worker runs on a
            // background thread, so wait for the answer: returning immediately
            // would let WorkManager stop us before it arrives.
            val done = CountDownLatch(1)
            manager.appUpdateInfo.addOnCompleteListener { done.countDown() }
            if (!done.await(30, TimeUnit.SECONDS)) return Result.success()
            val info = manager.appUpdateInfo.result
            if (info != null &&
                info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
            ) {
                notifyUpdateAvailable(applicationContext, info.availableVersionCode())
            }
            Result.success()
        } catch (_: Exception) {
            // A sideloaded build has no Play to ask - nothing to report.
            Result.success()
        }
    }
}
