package expo.modules.flobubble

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Ask Flo from the bubble: queue the question (with what's on the screen, see FloScreen), then wait for
 * the answer (~90 s max). Your computer answers; while it's off, the server answers in the cloud.
 */
internal class FloAsk(private val server: String, private val token: String) {
  class Failed(message: String) : Exception(message)

  /** Flo's server couldn't be reached at all (no network, or it's down): keep the question for later. */
  class Offline : Exception("offline")

  /** [cloud]: answered by the server's cloud AI because your computer was off. */
  data class Answer(val text: String, val cloud: Boolean)

  private fun call(method: String, path: String, body: JSONObject? = null, readMs: Int = 15_000): Pair<Int, JSONObject?> {
    val c = URL(server + path).openConnection() as HttpURLConnection
    try {
      c.requestMethod = method
      c.connectTimeout = 10_000
      c.readTimeout = readMs
      c.setRequestProperty("Authorization", "Bearer $token")
      c.setRequestProperty("Accept", "application/json")
      if (body != null) {
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json")
        c.outputStream.use { it.write(body.toString().toByteArray()) }
      }
      val code = c.responseCode
      val stream = if (code in 200..299) c.inputStream else c.errorStream
      val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
      return code to runCatching { JSONObject(text) }.getOrNull()
    } finally {
      c.disconnect()
    }
  }

  /**
   * Returns the answer. While the computer hasn't picked the question up, [waiting] gets the server's
   * reason (no computer signed in to this account, computer offline since…, busy) each time it changes.
   */
  /** [sent]: the server's request id, as soon as the question is queued there (for answers that come late). */
  fun ask(question: String, screen: String?, waiting: (String) -> Unit, cancelled: () -> Boolean, sent: (String) -> Unit = {}): Answer {
    val (code, json) = try {
      val body = JSONObject().put("mode", "ask").put("text", question)
      if (!screen.isNullOrBlank()) body.put("context", screen)
      call("POST", "/api/mobile/ask", body)
    } catch (e: IOException) {
      throw Offline()
    }
    if (code == 401) throw Failed("This phone isn't paired anymore. Open Flo to pair again.")
    if (code !in 200..299) throw Failed(json?.optString("error")?.takeIf { it.isNotBlank() } ?: "Flo had a problem ($code). Try again.")
    val id = json?.optJSONObject("request")?.opt("id")?.toString() ?: throw Failed("Flo sent an unexpected reply.")
    sent(id)
    val start = System.currentTimeMillis()
    var hint: String? = null
    while (System.currentTimeMillis() - start < 90_000) {
      if (cancelled()) throw Failed("")
      Thread.sleep(1_500)
      // the server may answer in the cloud during this poll (computer off): allow its ~20 s
      val body = try { call("GET", "/api/mobile/ask/$id", readMs = 35_000).second } catch (e: IOException) { null } ?: continue
      val r = body.optJSONObject("request") ?: continue
      when (r.optString("status")) {
        "done" -> return Answer(r.optString("answer").ifBlank { "Done." }, r.optString("answeredBy") == "cloud")
        "failed" -> throw Failed(r.optString("answer").ifBlank { "Your computer couldn't answer that." })
        "pending" -> {
          val next = body.optJSONObject("hint")?.optString("text")?.takeIf { it.isNotBlank() }
          if (next != null && next != hint) { hint = next; waiting(next) }
        }
        "taken" -> if (hint != null) { hint = null; waiting("Your computer is working on it.") }
      }
    }
    throw Failed(hint ?: "Your computer didn't answer in time. Make sure Flo is open on it and signed in.")
  }
}
