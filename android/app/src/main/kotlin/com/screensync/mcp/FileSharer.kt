package com.screensync.mcp

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.content.FileProvider
import java.io.File

/// Opens the Android share sheet for one of the app's own files: a gallery
/// frame ("shareImage") or the diagnostics report ("shareFile").
///
/// FileProvider only hands out files under a root declared in
/// res/xml/provider_paths.xml. Captures live in app_flutter (Flutter's documents
/// directory), which no root covers, so getUriForFile used to throw and "Share"
/// silently did nothing. Every file is now shared from cacheDir/share/ (the
/// "share" cache-path root): a file already there is used as is, any other one
/// is copied in first.
object FileSharer {
    private const val TAG = "ScreenSync"
    private const val SHARE_DIR = "share"

    /// Shared copies older than this are deleted on the next share. The
    /// receiving app has long since read them; the OS may clear the cache too.
    private const val MAX_AGE_MS = 24L * 60 * 60 * 1000

    /// True when the chooser opened.
    fun share(
        activity: Activity,
        path: String,
        mimeType: String,
        title: String,
        subject: String? = null,
    ): Boolean {
        return try {
            val source = File(path)
            if (!source.isFile) return false
            val dir = File(activity.cacheDir, SHARE_DIR).apply { mkdirs() }
            val target = stage(source, dir)
            pruneOld(dir, target)
            val uri: Uri = FileProvider.getUriForFile(
                activity, "${activity.packageName}.fileprovider", target
            )
            val send = Intent(Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(Intent.EXTRA_STREAM, uri)
                if (subject != null) putExtra(Intent.EXTRA_SUBJECT, subject)
                // ClipData carries the read grant through the chooser to the
                // app the user picks, and lets the chooser show a preview.
                clipData = ClipData.newRawUri(target.name, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(send, title))
            true
        } catch (e: Exception) {
            Log.w(TAG, "share failed", e)
            false
        }
    }

    /// The file to hand out: [source] itself when it is already in [dir],
    /// otherwise a fresh copy of it there.
    private fun stage(source: File, dir: File): File {
        if (source.canonicalFile.parentFile == dir.canonicalFile) return source
        val target = File(dir, source.name)
        source.copyTo(target, overwrite = true)
        return target
    }

    private fun pruneOld(dir: File, keep: File) {
        val cutoff = System.currentTimeMillis() - MAX_AGE_MS
        val keepPath = keep.canonicalPath
        dir.listFiles()?.forEach { f ->
            if (f.isFile && f.lastModified() < cutoff && f.canonicalPath != keepPath) {
                f.delete()
            }
        }
    }
}
