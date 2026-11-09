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

  fun setOffsetY(c: Context, y: Int) = sp(c).edit().putInt("y", y).apply()
  fun offsetY(c: Context): Int = sp(c).getInt("y", Int.MIN_VALUE)
}
