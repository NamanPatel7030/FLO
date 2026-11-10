package expo.modules.flobubble

import android.os.Build
import android.view.accessibility.AccessibilityNodeInfo

/**
 * What's on the phone screen, for Ask ("how should I reply to her?"). Read only at the moment the
 * user lets go of Ask (never for Dictate, never in the background) and sent with that one question.
 *
 * Privacy: only nodes visible to the user; password fields (and everything inside them) are never
 * read; the field being typed in contributes only its real text, never its hint. Capped at ~4000
 * characters, keeping the bottom of the screen (chats put the newest messages there).
 */
internal object FloScreen {
  const val CAP = 4000
  private const val MAX_NODES = 1500
  private const val MAX_DEPTH = 40
  private const val MAX_LINE = 1000

  /**
   * "App: WhatsApp (com.whatsapp)\nWindow: Priya\nAlready in the field: ...\n\n<screen lines>",
   * or null when there is nothing worth sending.
   */
  fun read(root: AccessibilityNodeInfo?, appLabel: String?, windowTitle: String?, target: AccessibilityNodeInfo?): String? {
    if (root == null) return null
    val lines = ArrayList<String>()
    val seen = HashSet<String>()
    var visited = 0
    fun walk(n: AccessibilityNodeInfo, depth: Int) {
      if (depth > MAX_DEPTH || visited >= MAX_NODES) return
      visited++
      if (!n.isVisibleToUser || n.isPassword) return
      val isTarget = target != null && n == target
      if (!isTarget) {
        val showingHint = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && n.isShowingHintText
        val text = (if (showingHint) null else n.text?.toString())?.takeIf { it.isNotBlank() }
          ?: n.contentDescription?.toString()?.takeIf { it.isNotBlank() && !n.isEditable }
        val line = text?.replace(Regex("\\s+"), " ")?.trim()?.take(MAX_LINE)
        if (!line.isNullOrEmpty() && seen.add(line)) lines.add(line)
      }
      for (i in 0 until n.childCount) {
        val c = runCatching { n.getChild(i) }.getOrNull() ?: continue
        walk(c, depth + 1)
      }
    }
    runCatching { walk(root, 0) }
    val field = target?.let { t ->
      val hint = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && t.isShowingHintText
      if (hint || t.isPassword) null else t.text?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.take(MAX_LINE)
    }
    return compose(root.packageName?.toString(), appLabel, windowTitle, field, lines)
  }

  /** Header + the bottom-most lines that fit in [cap]. */
  fun compose(pkg: String?, appLabel: String?, windowTitle: String?, field: String?, lines: List<String>, cap: Int = CAP): String? {
    val head = StringBuilder()
    val app = listOfNotNull(appLabel?.takeIf { it.isNotBlank() }, pkg?.takeIf { it.isNotBlank() }?.let { if (appLabel.isNullOrBlank()) it else "($it)" })
    if (app.isNotEmpty()) head.append("App: ").append(app.joinToString(" ")).append('\n')
    windowTitle?.trim()?.takeIf { it.isNotEmpty() && it != appLabel }?.let { head.append("Window: ").append(it.take(200)).append('\n') }
    field?.let { head.append("Already in the field: ").append(it).append('\n') }
    if (lines.isEmpty() && field == null) return null
    val room = cap - head.length - 1
    val kept = ArrayDeque<String>()
    var size = 0
    for (l in lines.asReversed()) {
      if (size + l.length + 1 > room) break
      kept.addFirst(l)
      size += l.length + 1
    }
    return (head.toString() + "\n" + kept.joinToString("\n")).trim()
  }
}
