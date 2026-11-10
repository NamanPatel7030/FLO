package expo.modules.flobubble

import android.content.Context

/** What the bubble needs from the app: the paired server + device token, and the user's on/off switch.
 *  App-private storage; the token only allows this phone's own requests and is revoked when unpaired. */
internal object Prefs {
  private const val FILE = "flo_bubble"

  private fun sp(c: Context) = c.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun setSession(c: Context, server: String?, token: String?) {
    sp(c).edit().apply {
      if (server.isNullOrBlank() || token.isNullOrBlank()) {
        remove("server"); remove("token")
      } else {
        putString("server", server.trimEnd('/')); putString("token", token)
      }
    }.apply()
  }

  fun server(c: Context): String? = sp(c).getString("server", null)
  fun token(c: Context): String? = sp(c).getString("token", null)

  fun setEnabled(c: Context, on: Boolean) = sp(c).edit().putBoolean("enabled", on).apply()
  fun enabled(c: Context): Boolean = sp(c).getBoolean("enabled", true)

  /** Where the thumb dock rests: which side, and its top as a fraction of the screen height (so it
   *  survives rotation). The old up/down offset ("y", from the edge-centered bubble) is dropped. */
  fun setDock(c: Context, right: Boolean, yFraction: Float) =
    sp(c).edit().putBoolean("dock_right", right).putFloat("dock_y", yFraction.coerceIn(0f, 1f)).remove("y").apply()
  fun dockRight(c: Context): Boolean = sp(c).getBoolean("dock_right", true)
  /** -1 until the dock has been moved once (then the default spot is used). */
  fun dockY(c: Context): Float = sp(c).getFloat("dock_y", -1f)
}
