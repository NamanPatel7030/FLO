package expo.modules.flobubble

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities

/**
 * Is the phone online? Event driven (ConnectivityManager callbacks): nothing polls, and the bubble
 * only hears about changes. "Online" means a network that reaches the internet (validated), so a
 * Wi-Fi without internet counts as offline.
 */
internal object FloNet {
  fun online(c: Context): Boolean {
    val cm = c.getSystemService(ConnectivityManager::class.java) ?: return true
    val n = cm.activeNetwork ?: return false
    val caps = cm.getNetworkCapabilities(n) ?: return false
    return usable(caps)
  }

  private fun usable(caps: NetworkCapabilities) =
    caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)

  /** Calls [changed] (on a binder thread) whenever the default network comes, goes or validates. */
  fun watch(c: Context, changed: (Boolean) -> Unit): ConnectivityManager.NetworkCallback? {
    val cm = c.getSystemService(ConnectivityManager::class.java) ?: return null
    val cb = object : ConnectivityManager.NetworkCallback() {
      private var last: Boolean? = null
      private fun report(on: Boolean) {
        if (on == last) return
        last = on
        changed(on)
      }
      override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = report(usable(caps))
      override fun onLost(network: Network) = report(false)
      override fun onUnavailable() = report(false)
    }
    return runCatching { cm.registerDefaultNetworkCallback(cb); cb }.getOrNull()
  }

  fun unwatch(c: Context, cb: ConnectivityManager.NetworkCallback?) {
    if (cb == null) return
    runCatching { c.getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(cb) }
  }
}
