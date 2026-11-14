package expo.modules.flobubble

import android.graphics.Color
import org.json.JSONArray
import org.json.JSONObject

/**
 * The bubble's settings, as the app resolved them (src/lib/bubbleSettings.ts `toNative`): the
 * gesture map is already the effective one and the colours already resolved, so the service only
 * reads values here. Anything missing or malformed falls back to the defaults below.
 */
internal data class BubbleConfig(
  val visible: Boolean = true,
  val dictation: Boolean = true,
  val assistant: Boolean = true,
  val tap: String = "dictate",
  val longPress: String = "ask",
  val doubleTap: String = "none",
  /** a quick flick away from the edge */
  val swipe: String = "none",
  val tapDelayMs: Long = 0L,
  /** "orb" | "glass" | "pill" | "dot" | "mascot" (FloOrb draws each) */
  val style: String = "orb",
  val sizeDp: Int = 46,
  val idleOpacity: Float = 0.8f,
  val accent: Int = DEFAULT_ACCENT,
  /** the far end of the bubble's gradient */
  val accent2: Int = DEFAULT_ACCENT2,
  /** "left" | "right" | "auto" */
  val side: String = "auto",
  /** "edge": glides to a side when let go. "free": stays where it's dropped. */
  val snap: String = "edge",
  val rememberPosition: Boolean = true,
  val tuck: Boolean = true,
  val tuckDelayMs: Long = 3200L,
  /** idle this long → hidden until the next text field (0 = never) */
  val autoHideMs: Long = 0L,
  /** "typing": next to text fields only. "always": on every screen. */
  val showWhen: String = "typing",
  /** "except": everywhere but [hiddenApps]. "only": just [onlyApps]. */
  val appsMode: String = "except",
  val hiddenApps: Set<String> = emptySet(),
  val onlyApps: Set<String> = emptySet(),
  val haptics: Boolean = true,
  /** "light" | "strong" */
  val hapticStrength: String = "light",
  val sounds: Boolean = false,
  /** BCP-47 tag, null = the phone's language */
  val langTag: String? = null,
  /** Android 14+: languages the recognizer may switch between (when [langTag] is null) */
  val langDetect: List<String> = emptyList(),
  /** "auto": best recognizer online, on-device offline. "device": always on-device. */
  val engine: String = "auto",
  /** "pause": stop when you stop talking. "tap": keep listening through pauses until tapped. */
  val stopOn: String = "pause",
  /** FloCleanup on what you said */
  val cleanup: Boolean = true,
  /** recognizer punctuation + a full stop at the end of longer dictations */
  val punctuation: Boolean = true,
  /** your words and names: recognizer hints and their spelling */
  val words: List<String> = emptyList(),
  /** "type" (set the text, paste as a fallback) | "paste" */
  val insert: String = "type",
  val preview: Boolean = true,
  val startOnBoot: Boolean = true,
) {
  /** What [gesture] ("tap" | "longPress" | "doubleTap" | "swipe") does, or null when it does nothing. */
  fun action(gesture: String): String? {
    val a = when (gesture) {
      "tap" -> tap
      "longPress" -> longPress
      "doubleTap" -> doubleTap
      "swipe" -> swipe
      else -> "none"
    }
    return when {
      a == "dictate" && dictation -> a
      a == "ask" && assistant -> a
      a == "openFlo" || a == "hide" -> a
      else -> null
    }
  }

  val shown: Boolean get() = visible && (dictation || assistant)

  /** Does the bubble show in [pkg] (an app's package name)? */
  fun showsIn(pkg: String?): Boolean =
    if (appsMode == "only") pkg != null && pkg in onlyApps else pkg !in hiddenApps

  val docked: Boolean get() = snap != "free"

  companion object {
    val DEFAULT_ACCENT: Int = Color.parseColor("#2F8CFF")
    val DEFAULT_ACCENT2: Int = Color.parseColor("#8DB9FF")
    val ACTIONS = setOf("dictate", "ask", "openFlo", "hide", "none")
    val STYLES = setOf("orb", "glass", "pill", "dot", "mascot")

    private fun strings(a: JSONArray?): List<String> =
      a?.let { (0 until it.length()).mapNotNull { i -> it.optString(i).takeIf { s -> s.isNotBlank() } } } ?: emptyList()

    private fun color(j: JSONObject, k: String, def: Int): Int =
      runCatching { Color.parseColor(j.optString(k, "")) }.getOrDefault(def)

    fun parse(raw: String?): BubbleConfig {
      if (raw.isNullOrBlank()) return BubbleConfig()
      val j = runCatching { JSONObject(raw) }.getOrNull() ?: return BubbleConfig()
      val d = BubbleConfig()
      fun str(k: String, ok: Set<String>, def: String) = j.optString(k, def).takeIf { it in ok } ?: def
      return BubbleConfig(
        visible = j.optBoolean("visible", d.visible),
        dictation = j.optBoolean("dictation", d.dictation),
        assistant = j.optBoolean("assistant", d.assistant),
        tap = str("tap", ACTIONS, d.tap),
        longPress = str("longPress", ACTIONS, d.longPress),
        doubleTap = str("doubleTap", ACTIONS, d.doubleTap),
        swipe = str("swipe", ACTIONS, d.swipe),
        tapDelayMs = j.optLong("tapDelayMs", d.tapDelayMs).coerceIn(0L, 600L),
        style = str("style", STYLES, d.style),
        sizeDp = j.optInt("sizeDp", d.sizeDp).coerceIn(32, 72),
        idleOpacity = j.optDouble("idleOpacity", d.idleOpacity.toDouble()).toFloat().coerceIn(0.3f, 1f),
        accent = color(j, "accent", DEFAULT_ACCENT),
        accent2 = color(j, "accent2", DEFAULT_ACCENT2),
        side = str("side", setOf("left", "right", "auto"), d.side),
        snap = str("snap", setOf("edge", "free"), d.snap),
        rememberPosition = j.optBoolean("rememberPosition", d.rememberPosition),
        tuck = j.optBoolean("tuck", d.tuck),
        tuckDelayMs = j.optLong("tuckDelayMs", d.tuckDelayMs).coerceIn(1000L, 30_000L),
        autoHideMs = j.optLong("autoHideMs", d.autoHideMs).coerceIn(0L, 600_000L),
        showWhen = str("showWhen", setOf("typing", "always"), d.showWhen),
        appsMode = str("appsMode", setOf("except", "only"), d.appsMode),
        hiddenApps = strings(j.optJSONArray("hiddenApps")).toSet(),
        onlyApps = strings(j.optJSONArray("onlyApps")).toSet(),
        haptics = j.optBoolean("haptics", d.haptics),
        hapticStrength = str("hapticStrength", setOf("light", "strong"), d.hapticStrength),
        sounds = j.optBoolean("sounds", d.sounds),
        langTag = if (j.isNull("langTag")) null else j.optString("langTag").takeIf { it.isNotBlank() },
        langDetect = strings(j.optJSONArray("langDetect")),
        engine = str("engine", setOf("auto", "device"), d.engine),
        stopOn = str("stopOn", setOf("pause", "tap"), d.stopOn),
        cleanup = j.optBoolean("cleanup", d.cleanup),
        punctuation = j.optBoolean("punctuation", d.punctuation),
        words = strings(j.optJSONArray("words")).take(60),
        insert = str("insert", setOf("type", "paste"), d.insert),
        preview = j.optBoolean("preview", d.preview),
        startOnBoot = j.optBoolean("startOnBoot", d.startOnBoot),
      )
    }
  }
}
