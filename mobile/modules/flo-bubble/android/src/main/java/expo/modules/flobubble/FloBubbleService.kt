package expo.modules.flobubble

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The Flo voice bubble. Tap a text field in any app and a small pill appears at the screen edge with
 * two buttons: hold Dictate and speak to type into the field, or hold Ask and speak to ask Flo
 * (answered by your computer; you can insert the answer).
 *
 * Light on battery by design: Android only wakes this service for focus/click/window events (see
 * res/xml/flo_bubble_service.xml); there are no timers, no wake locks and no network unless you ask
 * something, and the microphone is only open while you hold a button. Passwords are never touched.
 */
class FloBubbleService : AccessibilityService() {
  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()
  private var wm: WindowManager? = null

  private var bubble: LinearLayout? = null
  private var bubbleParams: WindowManager.LayoutParams? = null
  private var dictateBtn: TextView? = null
  private var askBtn: TextView? = null
  private var status: TextView? = null
  private var card: View? = null

  private var target: AccessibilityNodeInfo? = null
  private var recognizer: SpeechRecognizer? = null
  private var listening: String? = null // "dictate" | "ask"
  private var heard: String = ""
  private val askCancelled = AtomicBoolean(false)

  private val hide = Runnable { if (listening == null) removeBubble() }

  override fun onServiceConnected() {
    wm = getSystemService(WINDOW_SERVICE) as WindowManager
  }

  override fun onInterrupt() {}

  override fun onDestroy() {
    stopRecognizer()
    removeBubble()
    removeCard()
    io.shutdownNow()
    super.onDestroy()
  }

  // ── when to show ───────────────────────────────────────────────────────────

  override fun onAccessibilityEvent(e: AccessibilityEvent?) {
    if (e == null) return
    if (!Prefs.enabled(this)) {
      removeBubble(); return
    }
    when (e.eventType) {
      AccessibilityEvent.TYPE_VIEW_FOCUSED, AccessibilityEvent.TYPE_VIEW_CLICKED -> {
        val src = e.source ?: return
        if (src.packageName?.toString() == packageName) return // Flo's own app has Ask and Dictate built in
        if (isTypingField(src)) {
          target = src
          main.removeCallbacks(hide)
          showBubble()
        } else if (e.eventType == AccessibilityEvent.TYPE_VIEW_FOCUSED) {
          main.removeCallbacks(hide); main.postDelayed(hide, 250)
        }
      }
      AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
        if (e.packageName?.toString() == packageName) return
        // switched app or screen: keep the bubble only if a text field is still focused there
        val f = runCatching { rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) }.getOrNull()
        if (f != null && isTypingField(f)) {
          target = f
          main.removeCallbacks(hide)
          showBubble()
        } else {
          main.removeCallbacks(hide); main.postDelayed(hide, 250)
        }
      }
    }
  }

  private fun isTypingField(n: AccessibilityNodeInfo): Boolean = n.isEditable && !n.isPassword

  // ── the bubble ─────────────────────────────────────────────────────────────

  private fun dp(v: Int): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

  private fun round(color: Int, radius: Int) = GradientDrawable().apply {
    setColor(color); cornerRadius = dp(radius).toFloat()
  }

  private fun overlayParams(w: Int, h: Int) = WindowManager.LayoutParams(
    w, h,
    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
    // never take focus, so the keyboard and the text field stay as they are
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
    PixelFormat.TRANSLUCENT,
  )

  private fun button(glyph: String, label: String, tint: Int) = TextView(this).apply {
    text = "$glyph\n$label"
    setTextColor(Color.WHITE)
    textSize = 10.5f
    typeface = Typeface.DEFAULT_BOLD
    gravity = Gravity.CENTER
    background = round(tint, 22)
    setPadding(0, dp(6), 0, dp(6))
    layoutParams = LinearLayout.LayoutParams(dp(52), dp(52)).apply { setMargins(0, dp(3), 0, dp(3)) }
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun showBubble() {
    val w = wm ?: return
    if (bubble != null) return
    val pill = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      background = round(Color.parseColor("#E60B1220"), 30)
      setPadding(dp(5), dp(8), dp(5), dp(6))
      elevation = dp(8).toFloat()
    }
    val handle = TextView(this).apply {
      text = "Flo"
      setTextColor(Color.parseColor("#A9DCFF"))
      textSize = 10f
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      setPadding(0, 0, 0, dp(2))
    }
    val d = button("🎙", "Dictate", Color.parseColor("#2F8CFF"))
    val a = button("✦", "Ask", Color.parseColor("#7A6CFF"))
    val s = TextView(this).apply {
      textSize = 9.5f
      setTextColor(Color.parseColor("#C9D3E6"))
      gravity = Gravity.CENTER
      visibility = View.GONE
      maxWidth = dp(60)
    }
    pill.addView(handle); pill.addView(d); pill.addView(a); pill.addView(s)

    d.setOnTouchListener { v, ev -> holdToTalk(v, ev, "dictate") }
    a.setOnTouchListener { v, ev -> holdToTalk(v, ev, "ask") }
    // drag the "Flo" handle up or down to move the bubble; the spot is remembered
    var startY = 0f
    var startOffset = 0
    handle.setOnTouchListener { _, ev ->
      val p = bubbleParams ?: return@setOnTouchListener false
      when (ev.actionMasked) {
        MotionEvent.ACTION_DOWN -> { startY = ev.rawY; startOffset = p.y; true }
        MotionEvent.ACTION_MOVE -> {
          p.y = startOffset + (ev.rawY - startY).toInt()
          runCatching { w.updateViewLayout(pill, p) }; true
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { Prefs.setOffsetY(this, p.y); true }
        else -> false
      }
    }

    val p = overlayParams(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT).apply {
      gravity = Gravity.END or Gravity.CENTER_VERTICAL
      x = dp(6)
      val saved = Prefs.offsetY(this@FloBubbleService)
      y = if (saved == Int.MIN_VALUE) -dp(90) else saved
    }
    runCatching { w.addView(pill, p) }.onSuccess {
      bubble = pill; bubbleParams = p; dictateBtn = d; askBtn = a; status = s
      pill.alpha = 0f; pill.translationX = dp(24).toFloat()
      pill.animate().alpha(1f).translationX(0f).setDuration(180).start()
    }
  }

  private fun removeBubble() {
    val b = bubble ?: return
    bubble = null; bubbleParams = null; dictateBtn = null; askBtn = null; status = null
    runCatching { wm?.removeView(b) }
  }

  private fun setStatus(text: String?) {
    val s = status ?: return
    if (text.isNullOrBlank()) s.visibility = View.GONE else { s.text = text; s.visibility = View.VISIBLE }
  }

  // ── hold to talk ───────────────────────────────────────────────────────────

  private fun holdToTalk(v: View, ev: MotionEvent, mode: String): Boolean {
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        v.animate().scaleX(1.12f).scaleY(1.12f).setDuration(120).start()
        startListening(mode)
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        v.animate().scaleX(1f).scaleY(1f).setDuration(120).start()
        // stopping makes the recognizer deliver its final result
        if (listening == mode) {
          runCatching { recognizer?.stopListening() }
          setStatus("…")
        }
      }
    }
    return true
  }

  private fun toast(msg: String) = main.post { Toast.makeText(this, msg, Toast.LENGTH_LONG).show() }

  private fun startListening(mode: String) {
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      toast("Open Flo and allow the microphone to talk to the bubble.")
      return
    }
    if (!SpeechRecognizer.isRecognitionAvailable(this)) {
      toast("Speech recognition isn't available on this phone. Install or update the Google app.")
      return
    }
    if (mode == "ask" && (Prefs.server(this) == null || Prefs.token(this) == null)) {
      toast("Pair Flo with your computer first to ask questions.")
      return
    }
    stopRecognizer()
    listening = mode
    heard = ""
    setStatus("Listening")
    val r = SpeechRecognizer.createSpeechRecognizer(this)
    recognizer = r
    r.setRecognitionListener(object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) {}
      override fun onBeginningOfSpeech() {}
      override fun onRmsChanged(rmsdB: Float) {}
      override fun onBufferReceived(buffer: ByteArray?) {}
      override fun onEndOfSpeech() {}
      override fun onEvent(eventType: Int, params: Bundle?) {}
      override fun onPartialResults(b: Bundle?) {
        b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() }?.let { heard = it }
      }
      override fun onResults(b: Bundle?) {
        val text = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() } ?: heard
        finish(mode, text)
      }
      override fun onError(error: Int) {
        if (heard.isNotBlank()) { finish(mode, heard); return }
        finish(mode, "")
        when (error) {
          SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> toast("Didn't catch that. Hold the button while you speak.")
          SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> toast("Open Flo and allow the microphone.")
          SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> toast("Speech needs the internet right now. Check your connection.")
          else -> {}
        }
      }
    })
    val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
      // you decide when you're done by letting go, so allow long pauses
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 6000L)
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 6000L)
    }
    runCatching { r.startListening(i) }.onFailure {
      finish(mode, ""); toast("Couldn't start the microphone.")
    }
  }

  private fun stopRecognizer() {
    val r = recognizer ?: return
    recognizer = null
    runCatching { r.cancel() }
    runCatching { r.destroy() }
  }

  private fun finish(mode: String, text: String) {
    main.post {
      if (listening != mode) return@post
      listening = null
      stopRecognizer() // the microphone is closed from here on
      setStatus(null)
      if (text.isBlank()) return@post
      if (mode == "dictate") {
        if (!insert(text)) toast("Copied. Paste it into the field.")
      } else {
        ask(text)
      }
    }
  }

  // ── typing into the field ──────────────────────────────────────────────────

  /** Insert at the cursor (or append), with a space when needed. Falls back to paste. */
  private fun insert(raw: String): Boolean {
    val node = target
    copy(raw)
    if (node == null) return false
    runCatching { node.refresh() }
    val showingHint = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && node.isShowingHintText
    val current = if (showingHint) "" else node.text?.toString() ?: ""
    var start = node.textSelectionStart
    var end = node.textSelectionEnd
    if (start < 0 || end < 0 || start > current.length || end > current.length) { start = current.length; end = current.length }
    if (start > end) { val t = start; start = end; end = t }
    val before = current.substring(0, start)
    val after = current.substring(end)
    val pad = if (before.isNotEmpty() && !before.last().isWhitespace()) " " else ""
    val piece = pad + raw.trim()
    val next = before + piece + after
    val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, next) }
    if (node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
      val caret = before.length + piece.length
      node.performAction(
        AccessibilityNodeInfo.ACTION_SET_SELECTION,
        Bundle().apply {
          putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, caret)
          putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, caret)
        },
      )
      return true
    }
    // some fields (web pages, custom editors) ignore SET_TEXT but accept a paste
    return node.performAction(AccessibilityNodeInfo.ACTION_PASTE)
  }

  private fun copy(text: String) {
    runCatching {
      (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Flo", text))
    }
  }

  // ── Ask Flo ────────────────────────────────────────────────────────────────

  private fun ask(question: String) {
    val server = Prefs.server(this) ?: return
    val token = Prefs.token(this) ?: return
    askCancelled.set(false)
    val ui = showCard(question)
    io.execute {
      val result = runCatching {
        FloAsk(server, token).ask(question, waiting = { main.post { ui.answer.text = "Waiting for your computer. Flo needs to be open on it and signed in." } }, cancelled = { askCancelled.get() })
      }
      main.post {
        if (askCancelled.get()) return@post
        result.onSuccess { answer ->
          ui.answer.text = answer
          ui.answer.setTextColor(Color.parseColor("#0B1220"))
          ui.actions.visibility = View.VISIBLE
          ui.insert.setOnClickListener { if (insert(answer)) removeCard() else toast("Copied. Paste it into the field.") }
          ui.copy.setOnClickListener { copy(answer); toast("Copied"); removeCard() }
        }.onFailure { e ->
          ui.answer.text = e.message?.takeIf { it.isNotBlank() } ?: "Something went wrong. Try again."
          ui.answer.setTextColor(Color.parseColor("#B45309"))
        }
      }
    }
  }

  private class CardUi(val answer: TextView, val actions: View, val insert: TextView, val copy: TextView)

  private fun showCard(question: String): CardUi {
    removeCard()
    val w = wm!!
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      background = round(Color.parseColor("#F7F9FD"), 24)
      setPadding(dp(18), dp(14), dp(18), dp(14))
      elevation = dp(12).toFloat()
    }
    val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    val title = TextView(this).apply {
      text = "✦  Ask Flo"
      setTextColor(Color.parseColor("#7A6CFF")); textSize = 13f; typeface = Typeface.DEFAULT_BOLD
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    }
    val close = TextView(this).apply {
      text = "✕"; textSize = 16f; setTextColor(Color.parseColor("#5B6475")); setPadding(dp(10), dp(2), dp(2), dp(2))
      setOnClickListener { askCancelled.set(true); removeCard() }
    }
    head.addView(title); head.addView(close)
    val q = TextView(this).apply {
      text = question; textSize = 13f; setTextColor(Color.parseColor("#5B6475")); maxLines = 2
      setPadding(0, dp(6), 0, dp(8))
    }
    val answer = TextView(this).apply { text = "Thinking…"; textSize = 15f; setTextColor(Color.parseColor("#5B6475")); setTextIsSelectable(false) }
    val scroll = ScrollView(this).apply {
      addView(answer)
      layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
    }
    fun chip(label: String, dark: Boolean) = TextView(this).apply {
      text = label; textSize = 13.5f; typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
      setTextColor(if (dark) Color.WHITE else Color.parseColor("#0B1220"))
      background = round(if (dark) Color.parseColor("#0B1220") else Color.parseColor("#E6EAF2"), 18)
      setPadding(dp(16), dp(9), dp(16), dp(9))
      layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { setMargins(0, 0, dp(8), 0) }
    }
    val insert = chip("Insert", true)
    val copyBtn = chip("Copy", false)
    val actions = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(12), 0, 0); visibility = View.GONE
      addView(insert); addView(copyBtn)
    }
    root.addView(head); root.addView(q); root.addView(scroll); root.addView(actions)

    val maxH = (resources.displayMetrics.heightPixels * 0.42).toInt()
    scroll.viewTreeObserver.addOnGlobalLayoutListener {
      if (scroll.height > maxH) scroll.layoutParams = scroll.layoutParams.apply { height = maxH }
    }
    val p = overlayParams(resources.displayMetrics.widthPixels - dp(24), WindowManager.LayoutParams.WRAP_CONTENT).apply {
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      y = dp(56)
    }
    runCatching { w.addView(root, p) }.onSuccess { card = root }
    return CardUi(answer, actions, insert, copyBtn)
  }

  private fun removeCard() {
    val c = card ?: return
    card = null
    runCatching { wm?.removeView(c) }
  }
}
