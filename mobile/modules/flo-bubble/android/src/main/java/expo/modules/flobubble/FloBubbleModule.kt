package expo.modules.flobubble

import android.app.AppOpsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.os.Bundle
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

    /** Straight to Flo's switch in Accessibility where the phone allows it, else the list with Flo highlighted. */
    Function("openSettings") { openAccessibility(ctx) }

    /** Flo's App info page: on Android 13+ its menu holds "Allow restricted settings". */
    Function("openAppInfo") {
      ctx.startActivity(
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }

    /** "restricted" | "allowed" | "unknown": does Android 13+ block turning on Flo's accessibility
     *  service until "Allow restricted settings" (apps installed from a downloaded APK)? */
    Function("restrictedSettings") { restricted(ctx) }

    /** The Android API level, for the enable flow. */
    Function("sdkInt") { Build.VERSION.SDK_INT }
  }

  private fun openAccessibility(c: Context) {
    val me = ComponentName(c, FloBubbleService::class.java).flattenToString()
    if (Build.VERSION.SDK_INT >= 33) {
      // Android 13+: the service's own page (only works for the app that owns the service)
      val details = Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS")
        .putExtra(Intent.EXTRA_COMPONENT_NAME, me)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      if (runCatching { c.startActivity(details) }.isSuccess) return
    }
    // the list, scrolled to and highlighting Flo on Pixel / AOSP style Settings
    val args = Bundle().apply { putString(":settings:fragment_args_key", me) }
    c.startActivity(
      Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        .putExtra(":settings:fragment_args_key", me)
        .putExtra(":settings:show_fragment_args", args)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
  }

  private fun restricted(c: Context): String {
    if (Build.VERSION.SDK_INT < 33) return "allowed"
    // the app op behind "Allow restricted settings": allowed once the user allows it, errored while blocked
    val mode = runCatching {
      (c.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager)
        .unsafeCheckOpNoThrow("android:access_restricted_settings", c.applicationInfo.uid, c.packageName)
    }.getOrNull()
    if (mode == AppOpsManager.MODE_ALLOWED) return "allowed"
    if (mode == AppOpsManager.MODE_ERRORED || mode == AppOpsManager.MODE_IGNORED) return "restricted"
    // default (Android 15 decides by install source): store installs are never blocked
    val source = runCatching { c.packageManager.getInstallSourceInfo(c.packageName).packageSource }.getOrNull() ?: return "unknown"
    return when (source) {
      PackageInstaller.PACKAGE_SOURCE_LOCAL_FILE, PackageInstaller.PACKAGE_SOURCE_DOWNLOADED_FILE -> "restricted"
      PackageInstaller.PACKAGE_SOURCE_STORE -> "allowed"
      else -> "unknown"
    }
  }

  private fun serviceOn(c: Context): Boolean {
    val list = Settings.Secure.getString(c.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
    val me = ComponentName(c, FloBubbleService::class.java)
    val names = setOf(me.flattenToString(), me.flattenToShortString())
    return list.split(':').any { s -> names.any { it.equals(s, ignoreCase = true) } }
  }
}
