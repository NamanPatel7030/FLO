package expo.modules.flobubble

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * What the bubble needs from the app: the paired server + device token, the user's on/off switch and
 * the bubble's settings (BubbleConfig). Plus what the bubble keeps itself: where it rests, questions
 * said while offline (sent when the phone is back online) and a short history of recent dictations
 * and answers. App-private storage; the token only allows this phone's own requests and is revoked
 * when unpaired.
 */
internal object Prefs {
  const val FILE = "flo_bubble"
  const val KEY_CONFIG = "config"
  const val KEY_ENABLED = "enabled"
  private const val QUEUE_MAX = 20
  private const val HISTORY_MAX = 30
  private const val SCREEN_MAX = 2500

  fun sp(c: Context): SharedPreferences = c.getSharedPreferences(FILE, Context.MODE_PRIVATE)

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

  fun setEnabled(c: Context, on: Boolean) = sp(c).edit().putBoolean(KEY_ENABLED, on).apply()
  fun enabled(c: Context): Boolean = sp(c).getBoolean(KEY_ENABLED, true)

  // ── settings ───────────────────────────────────────────────────────────────

  @Volatile private var cachedRaw: String? = null
  @Volatile private var cached: BubbleConfig = BubbleConfig()

  fun setConfig(c: Context, json: String) = sp(c).edit().putString(KEY_CONFIG, json).apply()

  /** Parsed once per change, not per accessibility event. */
  fun config(c: Context): BubbleConfig {
    val raw = sp(c).getString(KEY_CONFIG, null)
    if (raw != cachedRaw) {
      cached = BubbleConfig.parse(raw)
      cachedRaw = raw
    }
    return cached
  }

  /** "Start on boot" off: after a restart the bubble waits until Flo is opened once. */
  fun setBootPaused(c: Context, on: Boolean) = sp(c).edit().putBoolean("boot_paused", on).apply()
  fun bootPaused(c: Context): Boolean = sp(c).getBoolean("boot_paused", false)

  // ── where it rests ─────────────────────────────────────────────────────────

  /** Which side, and its top as a fraction of the screen height (so it survives rotation). */
  fun setDock(c: Context, right: Boolean, yFraction: Float) =
    sp(c).edit().putBoolean("dock_right", right).putFloat("dock_y", yFraction.coerceIn(0f, 1f)).remove("y").apply()
  fun dockRight(c: Context): Boolean = sp(c).getBoolean("dock_right", true)
  /** -1 until the bubble has been moved once (then the default spot is used). */
  fun dockY(c: Context): Float = sp(c).getFloat("dock_y", -1f)

  // ── offline questions ──────────────────────────────────────────────────────

  private val lock = Any()

  private fun array(c: Context, key: String): JSONArray =
    runCatching { JSONArray(sp(c).getString(key, "[]")) }.getOrElse { JSONArray() }

  /** Keep [question] (with what was on screen) to send when the phone is back online. */
  fun enqueue(c: Context, question: String, screen: String?) = synchronized(lock) {
    val a = array(c, "queue")
    val o = JSONObject().put("id", System.currentTimeMillis().toString(36)).put("text", question).put("at", System.currentTimeMillis())
    if (!screen.isNullOrBlank()) o.put("screen", screen.take(SCREEN_MAX))
    a.put(o)
    while (a.length() > QUEUE_MAX) a.remove(0)
    sp(c).edit().putString("queue", a.toString()).commit()
  }

  /** The oldest kept question, removed from the queue (so the app and the service never both send it). */
  fun takeNext(c: Context): JSONObject? {
    synchronized(lock) {
      val a = array(c, "queue")
      if (a.length() == 0) return null
      val first = a.optJSONObject(0)
      a.remove(0)
      sp(c).edit().putString("queue", a.toString()).commit()
      return first
    }
  }

  /** Put a question back at the front (still offline). */
  fun requeue(c: Context, item: JSONObject) = synchronized(lock) {
    val a = array(c, "queue")
    val b = JSONArray().put(item)
    for (i in 0 until a.length()) b.put(a.get(i))
    sp(c).edit().putString("queue", b.toString()).commit()
  }

  /** Every kept question, removed (the app takes them over when the bubble service is off). */
  fun takeAll(c: Context): String = synchronized(lock) {
    val a = array(c, "queue")
    sp(c).edit().putString("queue", "[]").commit()
    strip(a).toString()
  }

  /** The kept questions, without their screen text. */
  fun queued(c: Context): String = synchronized(lock) { strip(array(c, "queue")).toString() }

  fun queueSize(c: Context): Int = synchronized(lock) { array(c, "queue").length() }

  private fun strip(a: JSONArray): JSONArray {
    val out = JSONArray()
    for (i in 0 until a.length()) {
      val o = a.optJSONObject(i) ?: continue
      out.put(JSONObject().put("id", o.optString("id")).put("text", o.optString("text")).put("at", o.optLong("at")))
    }
    return out
  }

  /** Sent from the bubble but not answered while it waited: the app picks the answer up later. */
  fun addLate(c: Context, requestId: String, question: String) = synchronized(lock) {
    val a = array(c, "late")
    a.put(JSONObject().put("requestId", requestId).put("text", question).put("at", System.currentTimeMillis()))
    while (a.length() > QUEUE_MAX) a.remove(0)
    sp(c).edit().putString("late", a.toString()).commit()
  }

  fun takeLate(c: Context): String = synchronized(lock) {
    val a = array(c, "late")
    sp(c).edit().putString("late", "[]").commit()
    a.toString()
  }

  // ── recent ─────────────────────────────────────────────────────────────────

  /**
   * [kind]: "dictate" (typed into a field), "copied" (no field took it), "ask" (answered), "queued"
   * (kept for later), "error". Newest first, capped. Lets you get back a dictation an app swallowed.
   */
  fun addHistory(c: Context, kind: String, text: String, answer: String? = null, cloud: Boolean = false) {
    if (text.isBlank()) return
    synchronized(lock) { addHistoryLocked(c, kind, text, answer, cloud) }
  }

  private fun addHistoryLocked(c: Context, kind: String, text: String, answer: String?, cloud: Boolean) {
    val a = array(c, "history")
    val o = JSONObject().put("kind", kind).put("text", text.take(4000)).put("at", System.currentTimeMillis())
    if (answer != null) o.put("answer", answer.take(4000))
    if (cloud) o.put("cloud", true)
    val b = JSONArray().put(o)
    for (i in 0 until minOf(a.length(), HISTORY_MAX - 1)) b.put(a.get(i))
    sp(c).edit().putString("history", b.toString()).apply()
  }

  fun history(c: Context): String = synchronized(lock) { array(c, "history").toString() }

  fun clearHistory(c: Context) = synchronized(lock) { sp(c).edit().putString("history", "[]").apply() }
}
