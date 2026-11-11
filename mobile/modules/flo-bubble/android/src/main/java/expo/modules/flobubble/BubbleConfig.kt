package expo.modules.flobubble

import android.graphics.Color
import org.json.JSONObject

/**
 * The bubble's settings, as the app resolved them (src/lib/bubbleSettings.ts `toNative`): the
 * gesture map is already the effective one and the accent already resolved, so the service only
 * reads values here. Anything missing or malformed falls back to the defaults below.
 */
internal data class BubbleConfig(
  val visible: Boolean = true,
  val dictation: Boolean = true,
  val assistant: Boolean = true,
  val tap: String = "dictate",
  val longPress: String = "ask",
  val doubleTap: String = "none",
  val tapDelayMs: Long = 0L,
  val sizeDp: Int = 46,
  val idleOpacity: Float = 0.8f,
  val accent: Int = DEFAULT_ACCENT,
  /** "left" | "right" | "auto" */
  val side: String = "auto",
  val tuck: Boolean = true,
  /** "typing": next to text fields only. "always": on every screen. */
  val showWhen: String = "typing",
  val hiddenApps: Set<String> = emptySet(),
  val haptics: Boolean = true,
  val sounds: Boolean = false,
  /** BCP-47 tag, null = the phone's language */
  val langTag: String? = null,
  /** Android 14+: languages the recognizer may switch between (when [langTag] is null) */
  val langDetect: List<String> = emptyList(),
  /** "auto": best recognizer online, on-device offline. "device": always on-device. */
  val engine: String = "auto",
  /** "type" (set the text, paste as a fallback) | "paste" */
  val insert: String = "type",
  val preview: Boolean = true,
  val startOnBoot: Boolean = true,
) {
  /** "dictate" | "ask" for [gesture] ("tap" | "longPress" | "doubleTap"), or null when it does nothing. */
  fun action(gesture: String): String? {
    val a = when (gesture) {
      "tap" -> tap
      "longPress" -> longPress
      "doubleTap" -> doubleTap
      else -> "none"
    }
    return when {
      a == "dictate" && dictation -> a
      a == "ask" && assistant -> a
      else -> null
    }
  }

  val shown: Boolean get() = visible && (dictation || assistant)

  companion object {
    val DEFAULT_ACCENT: Int = Color.parseColor("#2F8CFF")

    fun parse(raw: String?): BubbleConfig {
      if (raw.isNullOrBlank()) return BubbleConfig()
      val j = runCatching { JSONObject(raw) }.getOrNull() ?: return BubbleConfig()
      val d = BubbleConfig()
      fun str(k: String, ok: Set<String>, def: String) = j.optString(k, def).takeIf { it in ok } ?: def
      val actions = setOf("dictate", "ask", "none")
      val apps = j.optJSONArray("hiddenApps")?.let { a -> (0 until a.length()).mapNotNull { a.optString(it).takeIf { s -> s.isNotBlank() } }.toSet() } ?: emptySet()
      val detect = j.optJSONArray("langDetect")?.let { a -> (0 until a.length()).mapNotNull { a.optString(it).takeIf { s -> s.isNotBlank() } } } ?: emptyList()
      return BubbleConfig(
        visible = j.optBoolean("visible", d.visible),
        dictation = j.optBoolean("dictation", d.dictation),
        assistant = j.optBoolean("assistant", d.assistant),
        tap = str("tap", actions, d.tap),
        longPress = str("longPress", actions, d.longPress),
        doubleTap = str("doubleTap", actions, d.doubleTap),
        tapDelayMs = j.optLong("tapDelayMs", d.tapDelayMs).coerceIn(0L, 600L),
        sizeDp = j.optInt("sizeDp", d.sizeDp).coerceIn(32, 64),
        idleOpacity = j.optDouble("idleOpacity", d.idleOpacity.toDouble()).toFloat().coerceIn(0.3f, 1f),
        accent = runCatching { Color.parseColor(j.optString("accent", "")) }.getOrDefault(DEFAULT_ACCENT),
        side = str("side", setOf("left", "right", "auto"), d.side),
        tuck = j.optBoolean("tuck", d.tuck),
        showWhen = str("showWhen", setOf("typing", "always"), d.showWhen),
        hiddenApps = apps,
        haptics = j.optBoolean("haptics", d.haptics),
        sounds = j.optBoolean("sounds", d.sounds),
        langTag = if (j.isNull("langTag")) null else j.optString("langTag").takeIf { it.isNotBlank() },
        langDetect = detect,
        engine = str("engine", setOf("auto", "device"), d.engine),
        insert = str("insert", setOf("type", "paste"), d.insert),
        preview = j.optBoolean("preview", d.preview),
        startOnBoot = j.optBoolean("startOnBoot", d.startOnBoot),
      )
    }
  }
}
