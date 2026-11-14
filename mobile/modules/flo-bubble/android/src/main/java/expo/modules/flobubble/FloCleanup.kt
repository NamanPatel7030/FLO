package expo.modules.flobubble

/**
 * Dictation cleanup in the bubble: the same rules as the app's src/lib/cleanup.ts (which mirrors the
 * desktop's free local pass, src-tauri/src/text.rs), checked against the same cases
 * (modules/flo-bubble/cleanup-cases.json, see src/test/.../FloCleanupTest.kt). Pure Kotlin: no
 * Android calls, so it runs in a plain JVM unit test.
 *
 * Fillers and stutters go, spoken commands ("comma", "new line", "scratch that") become what they
 * say, your words get your spelling, sentences get capitals, and longer dictations end with a full
 * stop. Never translates and never changes the script.
 */
internal object FloCleanup {
  private val FILLERS = setOf("um", "uh", "erm", "uhm", "hmm", "mm")

  private val COMMON: Set<String> = (
    "a about after again all also am an and any are as ask asked at back be because been before being but by call came can " +
      "can't come could day did do does done don't down each even for from get give go going gone good got great had has have he " +
      "her here him his how i if in into is it it's its just know let like look made make many may me might more most much must my " +
      "need new no not now of off ok okay old on one only or our out over put said saw say see send sent set she should so some take " +
      "tell than that the their them then there these they they're think this those three time to today told too took two up us use " +
      "used very want was way we we're well went were what when where which who why will with won't work would yes yesterday " +
      "tomorrow you you're your four five week really still right"
    ).split(' ').toSet()

  private const val L = "\\p{L}\\p{M}"

  private val PUNCT = listOf(
    "full stop" to ".",
    "question mark" to "?",
    "exclamation mark" to "!",
    "exclamation point" to "!",
    "comma" to ",",
    "पूर्ण विराम" to "।",
    "प्रश्नवाचक चिह्न" to "?",
    "अल्पविराम" to ",",
  )
  private val BREAKS = listOf(
    "new paragraph" to "\n\n",
    "new line" to "\n",
    "नया पैराग्राफ" to "\n\n",
    "नई लाइन" to "\n",
  )

  private fun phrase(p: String): String =
    "(?<![$L])" + p.split(' ').joinToString("\\s+") { Regex.escape(it) } + "(?![$L])"

  private val BREAK_RX = BREAKS.map { (p, nl) -> Regex("[ ,;:]*${phrase(p)}[,.;:]*[ ]*", RegexOption.IGNORE_CASE) to " $nl " }
  private val PUNCT_RX = PUNCT.map { (p, mark) -> Regex("[ ,.;:।]*${phrase(p)}[,.;:।]*", RegexOption.IGNORE_CASE) to "$mark " }
  private val SCRATCH = Regex("(?<![$L])scratch that(?![$L])", RegexOption.IGNORE_CASE)
  private val SPACE = Regex("[\\s\\u00a0]+")
  private val WORDY = Regex("^[$L]+$")
  private val NOT_ALNUM = Regex("[^\\p{L}\\p{N}]")
  private val LONE_I = Regex("(?<![$L'’])i(?![$L])")
  private val CAPS = Regex("(^|[.!?]\\s+|\\n)(\\p{Ll})")
  private val HAS_LETTER = Regex("\\p{L}")
  private val SENTENCE_MARK = Regex("[.!?।]")
  private val WORD_END = Regex("[$L\\p{N}]")
  private val FIRST_WORD = Regex("^(\\p{Lu})(\\p{Ll}*)(?![$L])")
  private val TRAILING_SPACE = Regex("[ \\t]+$")

  private fun englishish(lang: String?) = lang == null || lang.lowercase().startsWith("en")

  /** Clean one dictation. [lang]: the recognizer's tag (null = the phone's language). */
  fun clean(raw: String, lang: String?, punctuation: Boolean, words: List<String>): String {
    var s = raw.replace(SPACE, " ").trim()
    if (s.isEmpty()) return ""
    val tag = lang?.lowercase()
    if (tag?.startsWith("gu") == true) s = s.replace('।', '.').replace('॥', '.')

    for ((rx, nl) in BREAK_RX) s = rx.replace(s) { nl }
    for ((rx, mark) in PUNCT_RX) s = rx.replace(s) { mark }
    s = scratch(s)

    val out = ArrayList<String>()
    for (tok in s.split(' ')) {
      if (tok.isEmpty()) continue
      val bare = tok.replace(NOT_ALNUM, "").lowercase()
      if (bare in FILLERS) continue
      val prev = out.lastOrNull()
      if (prev != null && WORDY.matches(tok) && prev.lowercase() == tok.lowercase()) continue
      out.add(tok)
    }
    s = spaceAfterPunctuation(out.joinToString(" "))

    for (w in words) {
      if (w.length < 2) continue
      s = Regex("(?<![$L\\p{N}])${Regex.escape(w)}(?![$L\\p{N}])", RegexOption.IGNORE_CASE).replace(s) { w }
    }
    s = tidy(s)
    if (s.isEmpty()) return ""
    if (englishish(lang)) s = LONE_I.replace(s) { "I" }
    s = CAPS.replace(s) { m -> m.groupValues[1] + m.groupValues[2].uppercase() }

    if (punctuation) {
      val last = s.last().toString()
      val count = s.split(Regex("\\s+")).count { HAS_LETTER.containsMatchIn(it) }
      if (WORD_END.matches(last) && (count >= 6 || SENTENCE_MARK.containsMatchIn(s))) {
        s += if (tag?.startsWith("hi") == true) "।" else "."
      }
    }
    return s
  }

  /** "let's meet Monday scratch that Tuesday" → "Tuesday": drops the sentence before each "scratch that". */
  private fun scratch(input: String): String {
    var s = input
    repeat(20) {
      val m = SCRATCH.find(s) ?: return s
      var start = m.range.first
      while (start > 0 && s[start - 1] !in ".!?\n।") start--
      var end = m.range.last + 1
      while (end < s.length && (s[end].isWhitespace() || s[end] in ",.;:!?।")) end++
      s = s.substring(0, start) + (if (start > 0 && s[start - 1] != '\n') " " else "") + s.substring(end)
    }
    return s
  }

  /** "colors.Like" → "colors. Like", "want,Light" → "want, Light" (text.rs space_after_punctuation). */
  fun spaceAfterPunctuation(t: String): String = t.split(' ').joinToString(" ") { token ->
    if (token.contains("://") || token.contains('@') || token.startsWith("www.")) return@joinToString token
    val cs = token.codePoints().toArray()
    val out = StringBuilder()
    for (k in cs.indices) {
      val c = cs[k]
      out.appendCodePoint(c)
      if (k == 0 || k + 1 >= cs.size) continue
      val prev = cs[k - 1]
      val next = cs[k + 1]
      if (!Character.isLetter(prev) || !Character.isLetter(next)) continue
      var run = 0
      var j = k - 1
      while (j >= 0 && Character.isLetter(cs[j])) { run++; j-- }
      val afterNextLower = k + 2 < cs.size && Character.isLowerCase(cs[k + 2])
      val add = when (c) {
        ','.code -> true
        '?'.code, '!'.code -> Character.isUpperCase(next)
        '.'.code -> Character.isUpperCase(next) && afterNextLower && run >= 2
        else -> false
      }
      if (add) out.append(' ')
    }
    out.toString()
  }

  private fun tidy(input: String): String = input
    .replace(Regex("[ \\t]+"), " ")
    .replace(Regex(" *\\n *"), "\n")
    .replace(Regex("\\n{3,}"), "\n\n")
    .replace(Regex(" +([,.;:!?।])"), "$1")
    .replace(Regex("([,;:])[,;:]+"), "$1")
    .replace(Regex("[,;:]+([.!?।])"), "$1")
    .replace(Regex("^[\\s,.;:।]+"), "")
    .replace(TRAILING_SPACE, "")
    .trim()

  /**
   * Fit a cleaned dictation to where it goes: a capital after a full stop (or at the start), a small
   * letter for an everyday word mid-sentence, a space before it after a word and after it before a
   * word, and no full stop when the sentence carries on after the cursor.
   */
  fun fit(text: String, before: String, after: String): String {
    var t = text.trim()
    if (t.isEmpty()) return ""
    val b = before.replace(TRAILING_SPACE, "")
    val sentenceStart = b.isEmpty() || b.last() in ".!?।\n"
    if (sentenceStart) {
      if (t[0].isLowerCase()) t = t[0].uppercaseChar() + t.substring(1)
    } else {
      val m = FIRST_WORD.find(t)
      if (m != null && m.value != "I" && m.value.lowercase() in COMMON) t = m.groupValues[1].lowercase() + t.substring(1)
    }
    val next = after.firstOrNull()
    if (next != null && (next.isLetter() || next.isDigit())) {
      if (next.isLowerCase() && t.endsWith(".") && !t.endsWith("..")) t = t.dropLast(1)
      t += " "
    }
    val prev = before.lastOrNull()
    if (prev != null && !prev.isWhitespace() && t[0] !in ",.;:!?।") t = " $t"
    return t
  }
}
