package expo.modules.flobubble

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Toast
import androidx.core.content.ContextCompat
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The Flo voice bubble. Tap a text field in any app and a small dock appears low on the screen edge,
 * in reach of your thumb, with two buttons: hold Dictate and speak to type into the field, or hold
 * Ask and speak to ask Flo (answered by your computer; you can insert the answer). Drag the dock
 * anywhere. While Flo listens, thinks or answers, a black island at the top of the screen (over the
 * camera) shows what is happening and opens into the answer card. See FloDock and FloIsland.
 *
 * Light on battery by design: Android only wakes this service for focus/click/window events (see
 * res/xml/flo_bubble_service.xml); there are no timers, no wake locks and no network unless you ask
 * something, and the microphone is only open while you hold a button. Passwords are never touched.
 */
class FloBubbleService : AccessibilityService() {
  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()
  private var dock: FloDock? = null
  private var island: FloIsland? = null

  private var target: AccessibilityNodeInfo? = null
  private var recognizer: SpeechRecognizer? = null
  private var listening: String? = null // "dictate" | "ask"
  private var heard: String = ""
  private var askCancel: AtomicBoolean? = null // the Ask in flight, if any
  private var askScreen: String? = null // what was on screen when you let go of Ask (FloScreen)

  private val hide = Runnable { if (listening == null) dock?.hide() }

  override fun onServiceConnected() {
    val w = getSystemService(WINDOW_SERVICE) as WindowManager
    dock = FloDock(
      this, w,
      onHoldStart = { mode -> startListening(mode) },
      onHoldEnd = { mode -> stopTalking(mode) },
      onTap = { mode -> if (listening == null) island?.hint(mode) },
    )
    island = FloIsland(this, w).apply {
      onClose = { cancelAsk(); island?.dismiss() }
      onInsert = { text ->
        askCancel = null
        if (insert(text)) island?.done("Inserted", R.drawable.flo_ic_check, "ask")
        else { toast("Copied. Paste it into the field."); island?.dismiss() }
      }
      onCopy = { text ->
        askCancel = null
        copy(text)
        island?.done("Copied", R.drawable.flo_ic_copy, "ask")
      }
    }
  }

  override fun onInterrupt() {}

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    dock?.reposition()
    island?.relayout()
  }

  override fun onDestroy() {
    stopRecognizer()
    cancelAsk()
    dock?.hide()
    island?.dismissNow()
    io.shutdownNow()
    super.onDestroy()
  }

  // ── when to show ───────────────────────────────────────────────────────────

  override fun onAccessibilityEvent(e: AccessibilityEvent?) {
    if (e == null) return
    if (!Prefs.enabled(this)) {
      dock?.hide(); return
    }
    when (e.eventType) {
      AccessibilityEvent.TYPE_VIEW_FOCUSED, AccessibilityEvent.TYPE_VIEW_CLICKED -> {
        val src = e.source ?: return
        if (src.packageName?.toString() == packageName) return // Flo's own app has Ask and Dictate built in
        if (isTypingField(src)) {
          target = src
          main.removeCallbacks(hide)
          dock?.show()
        } else if (e.eventType == AccessibilityEvent.TYPE_VIEW_FOCUSED) {
          main.removeCallbacks(hide); main.postDelayed(hide, 250)
        }
      }
      AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
        if (e.packageName?.toString() == packageName) return
        // switched app or screen: keep the dock only if a text field is still focused there
        val f = runCatching { rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) }.getOrNull()
        if (f != null && isTypingField(f)) {
          target = f
          main.removeCallbacks(hide)
          dock?.show()
        } else {
          main.removeCallbacks(hide); main.postDelayed(hide, 250)
        }
      }
    }
  }

  private fun isTypingField(n: AccessibilityNodeInfo): Boolean = n.isEditable && !n.isPassword

  // ── hold to talk ───────────────────────────────────────────────────────────

  private fun toast(msg: String) = main.post { Toast.makeText(this, msg, Toast.LENGTH_LONG).show() }

  /** Opens the microphone for [mode]. Returns false (with a toast saying why) if it can't. */
  private fun startListening(mode: String): Boolean {
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      toast("Open Flo and allow the microphone to talk to the bubble.")
      return false
    }
    if (!SpeechRecognizer.isRecognitionAvailable(this)) {
      toast("Speech recognition isn't available on this phone. Install or update the Google app.")
      return false
    }
    if (mode == "ask" && (Prefs.server(this) == null || Prefs.token(this) == null)) {
      toast("Pair Flo with your computer first to ask questions.")
      return false
    }
    stopRecognizer()
    cancelAsk() // a new question or dictation replaces whatever the island was showing
    listening = mode
    heard = ""
    val r = runCatching { SpeechRecognizer.createSpeechRecognizer(this) }.getOrNull()
    if (r == null) {
      listening = null; toast("Couldn't start the microphone."); return false
    }
    recognizer = r
    island?.listening(mode)
    r.setRecognitionListener(object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) {}
      override fun onBeginningOfSpeech() {}
      override fun onRmsChanged(rmsdB: Float) {
        if (recognizer === r) island?.level(rmsdB)
      }
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
    return true
  }

  /** You let go: stopping makes the recognizer deliver its final result. */
  private fun stopTalking(mode: String) {
    if (listening != mode) return
    runCatching { recognizer?.stopListening() }
    island?.working(mode)
    // Ask only (never Dictate): read the visible screen now, so the answer fits the conversation
    // you're in. Never password fields; sent once with this question. See FloScreen.
    askScreen = if (mode == "ask") readScreen() else null
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
      if (text.isBlank()) { island?.dismiss(); return@post }
      if (mode == "dictate") {
        if (insert(text)) {
          island?.done("Typed", R.drawable.flo_ic_check, "dictate")
        } else {
          island?.done("Copied", R.drawable.flo_ic_copy, "dictate")
          toast("Copied. Paste it into the field.")
        }
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

  private fun cancelAsk() {
    askCancel?.set(true)
    askCancel = null
  }

  /** The visible screen of the app you're typing in, for Ask. Null for Flo's own app or on any error. */
  private fun readScreen(): String? = runCatching {
    val root = rootInActiveWindow ?: return@runCatching null
    val pkg = root.packageName?.toString() ?: return@runCatching null
    if (pkg == packageName) return@runCatching null
    val label = runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString() }.getOrNull()
    val title = runCatching { root.window?.title?.toString() }.getOrNull()
    FloScreen.read(root, label, title, target?.also { runCatching { it.refresh() } })
  }.getOrNull()

  private fun ask(question: String) {
    val server = Prefs.server(this) ?: return
    val token = Prefs.token(this) ?: return
    val screen = askScreen ?: readScreen() // the recognizer ended before you let go
    askScreen = null
    cancelAsk()
    val cancel = AtomicBoolean(false)
    askCancel = cancel
    island?.askPending(question)
    io.execute {
      val result = runCatching {
        // waiting: the server's reason the computer hasn't answered yet (may change while we wait)
        FloAsk(server, token).ask(question, screen, waiting = { msg -> main.post { if (!cancel.get()) island?.askStatus(msg) } }, cancelled = { cancel.get() })
      }
      main.post {
        if (cancel.get()) return@post
        result.onSuccess { a ->
          // type the answer straight into the field you were in; show it with Insert / Copy only
          // when the field can't take it (closed, or an app that ignores typing)
          if (insert(a.text)) {
            askCancel = null
            island?.done(if (a.cloud) "Inserted (cloud)" else "Inserted", R.drawable.flo_ic_check, "ask")
          } else {
            island?.askAnswer(a.text)
            if (a.cloud) toast("Answered in the cloud (your computer is off)")
          }
        }.onFailure { e ->
          island?.askError(e.message?.takeIf { it.isNotBlank() } ?: "Something went wrong. Try again.")
        }
      }
    }
  }
}
