package com.screensync.mcp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build

/// The ongoing "ScreenSync capture active" notification that keeps
/// [ScreenCaptureService] alive as a foreground service, with its Snap / MCP /
/// Pause quick-action buttons.
object CaptureNotification {
    private const val CHANNEL_ID = "screensync_capture"
    const val NOTIFICATION_ID = 4201

    /// minSdk is 24 but notification channels exist from API 26 only.
    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Screen capture",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Shown while ScreenSync can capture the display"
            setShowBadge(false)
        }
        context.getSystemService(NotificationManager::class.java)
            .createNotificationChannel(channel)
    }

    @Suppress("DEPRECATION")
    fun build(context: Context, paused: Boolean): Notification {
        val openAppIntent = PendingIntent.getActivity(
            context, 0,
            context.packageManager.getLaunchIntentForPackage(context.packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        fun actionIntent(action: String, requestCode: Int): PendingIntent =
            PendingIntent.getBroadcast(
                context, requestCode,
                Intent(action).setPackage(context.packageName),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

        fun action(label: String, intent: PendingIntent): Notification.Action =
            Notification.Action.Builder(
                Icon.createWithResource(context, context.applicationInfo.icon),
                label,
                intent,
            ).build()

        // Notification.Builder(context, channelId) needs API 26; minSdk is 24.
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(context, CHANNEL_ID)
        } else {
            Notification.Builder(context)
        }

        return builder
            .setSmallIcon(context.applicationInfo.icon)
            .setContentTitle(if (paused) "ScreenSync — paused" else "ScreenSync capture active")
            .setContentText(
                if (paused) "Tap ▶ to resume"
                else "Tap bubble · long-press = region select · shake = auto-capture"
            )
            .setContentIntent(openAppIntent)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            // Priority is what keeps it quiet before API 26 (no channels); from
            // 26 on the channel's importance decides and this is ignored.
            .setPriority(Notification.PRIORITY_LOW)
            .addAction(action("📸 Snap", actionIntent(ScreenCaptureService.ACTION_SNAP, 1)))
            .addAction(action("⚡ MCP", actionIntent(ScreenCaptureService.ACTION_TRIGGER_MCP, 2)))
            .addAction(
                action(
                    if (paused) "▶ Resume" else "⏸ Pause",
                    actionIntent(ScreenCaptureService.ACTION_PAUSE, 3),
                )
            )
            .build()
    }
}
