package expo.modules.flobubble

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Notifications from the bubble itself (no server push involved): the answer to a question you asked
 * while offline, once the phone is back online, and "download offline speech" when a language pack is
 * missing. Tapping opens Flo on the right screen (flo-pair://bubble, flo-pair://speech).
 */
internal object FloNotify {
  private const val CHANNEL = "flo_bubble"
  private var seq = 4100

  private fun allowed(c: Context): Boolean =
    Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

  private fun channel(c: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = c.getSystemService(NotificationManager::class.java) ?: return
    if (nm.getNotificationChannel(CHANNEL) != null) return
    nm.createNotificationChannel(
      NotificationChannel(CHANNEL, "Voice bubble", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "Answers to questions you asked the bubble while offline"
      },
    )
  }

  private fun open(c: Context, path: String): PendingIntent {
    val i = Intent(Intent.ACTION_VIEW, Uri.parse("flo-pair://$path")).setPackage(c.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(c, path.hashCode(), i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  @SuppressLint("MissingPermission") // checked in allowed()
  fun show(c: Context, title: String, text: String, path: String) {
    if (!allowed(c)) return
    channel(c)
    val n = NotificationCompat.Builder(c, CHANNEL)
      .setSmallIcon(R.drawable.flo_ic_sparkle)
      .setContentTitle(title)
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setColor(BubbleConfig.DEFAULT_ACCENT)
      .setAutoCancel(true)
      .setContentIntent(open(c, path))
      .build()
    runCatching { NotificationManagerCompat.from(c).notify(seq++, n) }
  }
}
