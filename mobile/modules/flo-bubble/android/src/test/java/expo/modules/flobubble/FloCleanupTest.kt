package expo.modules.flobubble

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/** FloCleanup against the shared cases (modules/flo-bubble/cleanup-cases.json), the same ones jest runs on cleanup.ts. */
class FloCleanupTest {
  private val cases: JSONObject by lazy {
    // gradle runs unit tests from the module's directory (modules/flo-bubble/android)
    val f = listOf(File("../cleanup-cases.json"), File("modules/flo-bubble/cleanup-cases.json")).first { it.exists() }
    JSONObject(f.readText())
  }

  @Test
  fun clean() {
    val a = cases.getJSONArray("clean")
    for (i in 0 until a.length()) {
      val c = a.getJSONObject(i)
      val words = c.optJSONArray("words")?.let { w -> (0 until w.length()).map { w.getString(it) } } ?: emptyList()
      val lang = if (c.has("lang")) c.getString("lang") else null
      val got = FloCleanup.clean(c.getString("in"), lang, c.optBoolean("punctuation", true), words)
      assertEquals("clean(${c.getString("in")})", c.getString("out"), got)
    }
  }

  @Test
  fun fit() {
    val a = cases.getJSONArray("fit")
    for (i in 0 until a.length()) {
      val c = a.getJSONObject(i)
      val got = FloCleanup.fit(c.getString("text"), c.getString("before"), c.getString("after"))
      assertEquals("fit(${c.getString("before")} + ${c.getString("text")})", c.getString("out"), got)
    }
  }
}
