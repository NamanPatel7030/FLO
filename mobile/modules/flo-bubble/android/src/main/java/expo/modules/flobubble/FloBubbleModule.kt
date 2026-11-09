package expo.modules.flobubble

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FloBubbleModule : Module() {
  private val ctx: Context
    get() = appContext.reactContext ?: throw IllegalStateException("Flo isn't ready yet")

  override fun definition() = ModuleDefinition {
    Name("FloBubble")

    Function("setSession") { server: String?, token: String? -> Prefs.setSession(ctx, server, token) }

    Function("setEnabled") { on: Boolean -> Prefs.setEnabled(ctx, on) }

    Function("isEnabled") { Prefs.enabled(ctx) }

    /** Is the accessibility service switched on in Android settings? */
    Function("isServiceOn") { serviceOn(ctx) }

    Function("openSettings") {
      ctx.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }

  private fun serviceOn(c: Context): Boolean {
    val list = Settings.Secure.getString(c.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
    val me = ComponentName(c, FloBubbleService::class.java)
    val names = setOf(me.flattenToString(), me.flattenToShortString())
    return list.split(':').any { s -> names.any { it.equals(s, ignoreCase = true) } }
  }
}
