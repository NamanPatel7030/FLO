package expo.modules.flobubble

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.media.AudioManager
import android.media.ToneGenerator
import android.net.ConnectivityManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.SpeechRecognizer
import android.view.HapticFeedbackConstants
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Toast
import androidx.core.content.ContextCompat
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The Flo voice bubble: a small orb on the screen edge (FloBubble / FloOrb) for dictation into any
 * app and quick questions to Flo. What each gesture does (tap, hold, double-tap), which modes are on
 * and how it looks come from the app's settings (BubbleConfig). Ask answers and their status show in
 * a black island at the top of the screen (FloIsland).
 *
 * Offline:
 * - Dictation works with no internet: on-device speech recognition when offline (FloSpeech), and a
 *   network failure switches the next try to on-device by itself.
 * - Questions asked offline are kept (Prefs.enqueue) and sent the moment the phone is back online
 *   (a ConnectivityManager callback, not polling); the answer arrives as a notification and in the
 *   app's Recent list.
 *
 * Light on battery by design: Android only wakes this service for focus/click/window events (see
 * res/xml/flo_bubble_service.xml); no timers or wake locks; the network is used only when you ask
 * something or a kept question is waiting; the microphone is open only while you talk. Passwords are
 * never touched.
 */
class FloBubbleService : AccessibilityService(), FloBubble.Listener {
  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor() // live questions
  private val bg = Executors.newSingleThreadExecutor() // kept questions, sent when back online
  private var bubble: FloBubble? = null
  private var island: FloIsland? = null
  private var cfg = BubbleConfig()

  private var target: AccessibilityNodeInfo? = null
  private var recognizer: SpeechRecognizer? = null
  private var listening: String? = null // "dictate" | "ask"
  private var holding = false
  private var onDevice = false
  private var heard: String = ""
  /** continuous listening: what earlier sessions already heard */
  private val acc = StringBuilder()
  private var continuous = false
  private var stopping = false
  private var sessionStart = 0L
  private var emptyRuns = 0
  private var offlineSpeech = false
  private var formatting = true
  private var formattingRetried = false
  /** a recognizer refused punctuation formatting once: don't ask it again this time the service runs */
  private var formattingRefused = false
  /** "Hide" gesture: stays away in this app until you switch to another one */
  private var snoozedIn: String? = null
  private var lastStopAt = 0L
  private var askCancel: AtomicBoolean? = null // the Ask in flight, if any
  private var askScreen: String? = null // what was on screen when you stopped talking (FloScreen)
  private var online = true
  /** after a network failure, listen on-device until then */
  private var deviceUntil = 0L
  private var netWatch: ConnectivityManager.NetworkCallback? = null
  private val flushing = AtomicBoolean(false)
  private val destroyed = AtomicBoolean(false)
  private var tones: ToneGenerator? = null

  private val hide = Runnable { if (!busy()) bubble?.hide() }
  private val backToIdle = Runnable { if (listening == null && askCancel == null) bubble?.setState(FloOrb.State.IDLE) }

  private val prefsChanged = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
    if (key == Prefs.KEY_CONFIG || key == Prefs.KEY_ENABLED || key == "boot_paused") main.post { applyConfig() }
    if (key == Prefs.KEY_DOCK_RESET) main.post { bubble?.reposition() }
  }

  override fun onServiceConnected() {
    val w = getSystemService(WINDOW_SERVICE) as WindowManager
    cfg = Prefs.config(this)
    // "Start on boot" off: if Android started us right after a restart, wait until Flo is opened
    if (!cfg.startOnBoot && SystemClock.elapsedRealtime() < BOOT_WINDOW_MS) Prefs.setBootPaused(this, true)
    bubble = FloBubble(this, w, this)
    island = FloIsland(this, w).apply {
      onClose = { cancelAsk(); island?.dismiss(); bubble?.setState(FloOrb.State.IDLE) }
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
    Prefs.sp(this).registerOnSharedPreferenceChangeListener(prefsChanged)
    online = FloNet.online(this)
    bubble?.setOffline(!online)
    netWatch = FloNet.watch(this) { on ->
      main.post {
        online = on
        bubble?.setOffline(!on)
        if (on) flush()
      }
    }
    if (online) flush()
  }

  override fun onInterrupt() {}

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    bubble?.reposition()
    island?.relayout()
  }

  override fun onDestroy() {
    destroyed.set(true)
    Prefs.sp(this).unregisterOnSharedPreferenceChangeListener(prefsChanged)
    FloNet.unwatch(this, netWatch)
    stopRecognizer()
    cancelAsk()
    bubble?.hide()
    island?.dismissNow()
    io.shutdownNow()
    bg.shutdownNow()
    runCatching { tones?.release() }
    super.onDestroy()
  }

  // ── when to show ───────────────────────────────────────────────────────────

  private fun allowedNow(): Boolean = Prefs.enabled(this) && cfg.shown && !Prefs.bootPaused(this)

  private fun applyConfig() {
    cfg = Prefs.config(this)
    val b = bubble ?: return
    if (!allowedNow()) {
      if (!busy()) b.hide()
      return
    }
    if (b.isShown) {
      // e.g. "Only in these apps" just changed and this app isn't one of them
      val pkg = runCatching { rootInActiveWindow?.packageName?.toString() }.getOrNull()
      if (pkg != null && pkg != packageName && !showsIn(pkg) && !busy()) b.hide() else b.applyConfig(cfg)
    } else if (cfg.showWhen == "always") {
      val pkg = runCatching { rootInActiveWindow?.packageName?.toString() }.getOrNull()
      if (pkg != null && showsIn(pkg)) showNow()
    }
  }

  private fun showsIn(pkg: String?): Boolean = pkg != packageName && pkg != snoozedIn && cfg.showsIn(pkg)

  private fun showNow() {
    main.removeCallbacks(hide)
    bubble?.show(cfg)
  }

  private fun hideSoon() {
    main.removeCallbacks(hide)
    main.postDelayed(hide, 250)
  }

  override fun onAccessibilityEvent(e: AccessibilityEvent?) {
    if (e == null) return
    cfg = Prefs.config(this)
    if (!allowedNow()) {
      if (!busy()) bubble?.hide()
      return
    }
    when (e.eventType) {
      AccessibilityEvent.TYPE_VIEW_FOCUSED, AccessibilityEvent.TYPE_VIEW_CLICKED -> {
        val src = e.source ?: return
        val pkg = src.packageName?.toString()
        if (pkg == packageName) return // Flo's own app has Ask and Dictate built in
        if (!showsIn(pkg)) { hideSoon(); return }
        if (isTypingField(src)) {
          target = src
          showNow()
        } else if (e.eventType == AccessibilityEvent.TYPE_VIEW_FOCUSED && cfg.showWhen == "typing") {
          hideSoon()
        }
      }
      AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
        val pkg = e.packageName?.toString()
        if (pkg == SYSTEM_UI) return // the notification shade comes and goes over the app
        if (snoozedIn != null && pkg != null && pkg != snoozedIn && pkg != packageName && !isKeyboard(pkg)) snoozedIn = null // another app: back again
        if (pkg == packageName || !showsIn(pkg)) {
          if (!busy()) { main.removeCallbacks(hide); bubble?.hide() }
          return
        }
        // switched app or screen: keep the bubble if a text field is still focused there (or always)
        val f = runCatching { rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) }.getOrNull()
        if (f != null && isTypingField(f)) {
          target = f
          showNow()
        } else if (cfg.showWhen == "always") {
          if (listening == null) target = null
          showNow()
        } else {
          hideSoon()
        }
      }
    }
  }

  private fun isTypingField(n: AccessibilityNodeInfo): Boolean = n.isEditable && !n.isPassword

  /** The keyboard's own windows come and go while you type: they aren't "another app". */
  private fun isKeyboard(pkg: String): Boolean = runCatching {
    Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)?.startsWith("$pkg/") == true
  }.getOrDefault(false)

  // ── gestures (FloBubble.Listener) ──────────────────────────────────────────

  override fun busy(): Boolean = listening != null

  override fun onTap() = gesture("tap")

  override fun onDoubleTap() = gesture("doubleTap")

  override fun onSwipe(): Boolean {
    if (listening != null) return false
    val action = cfg.action("swipe") ?: return false
    perform(action, hold = false)
    return true
  }

  override fun onIdle() {
    if (busy() || askCancel != null) return
    bubble?.hide()
  }

  private fun gesture(g: String) {
    if (listening != null) { stopTalking(); return }
    val action = cfg.action(g)
    if (action == null) {
      bubble?.caption(howTo(), 1800)
      return
    }
    perform(action, hold = false)
  }

  /** Do [action]: listen for dictation or a question, open Flo, or hide until you switch apps. */
  private fun perform(action: String, hold: Boolean): Boolean = when (action) {
    "openFlo" -> {
      bubble?.haptic(CONFIRM)
      val i = packageManager.getLaunchIntentForPackage(packageName)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      if (i != null) runCatching { startActivity(i) }
      false
    }
    "hide" -> {
      snoozedIn = runCatching { rootInActiveWindow?.packageName?.toString() }.getOrNull()
      bubble?.haptic(CONFIRM)
      bubble?.hide()
      if (snoozedIn != null) toast("Flo bubble hidden here. It's back when you switch apps.")
      false
    }
    else -> startListening(action, hold)
  }

  override fun onHoldStart(): Boolean {
    if (listening != null) return false
    val action = cfg.action("longPress") ?: run { bubble?.caption(howTo(), 1800); return false }
    return perform(action, hold = true)
  }

  override fun onHoldEnd() = stopTalking()

  override fun onDismiss() {
    stopRecognizer(); listening = null
    bubble?.hide()
    Prefs.setEnabled(this, false)
    toast("Flo bubble hidden. Turn it back on in Flo, Settings, Voice bubble.")
  }

  /** "Tap to dictate · Hold to ask Flo", from the current settings. */
  private fun howTo(): String {
    val names = mapOf("tap" to "Tap", "longPress" to "Hold", "doubleTap" to "Double-tap")
    val parts = names.mapNotNull { (g, label) -> cfg.action(g)?.let { "$label to ${when (it) { "ask" -> "ask Flo"; "openFlo" -> "open Flo"; "hide" -> "hide"; else -> "dictate" }}" } }
    return parts.joinToString(" · ").ifEmpty { "Turn on Dictation or Ask in Flo settings." }
  }

  private fun modeColor(mode: String): Int =
    if (mode == "ask") (if (cfg.accent == FloColors.ASK) FloColors.ASK_SOFT else FloColors.ASK) else cfg.accent

  // ── listening ──────────────────────────────────────────────────────────────

  private fun toast(msg: String) = main.post { Toast.makeText(this, msg, Toast.LENGTH_LONG).show() }

  private fun tone(kind: Int) {
    if (!cfg.sounds) return
    val t = tones ?: runCatching { ToneGenerator(AudioManager.STREAM_SYSTEM, 35) }.getOrNull()?.also { tones = it } ?: return
    runCatching { t.startTone(kind, 120) }
  }

  /** Something went wrong: red ring, a short shake and why, then back to rest. */
  private fun fail(msg: String) {
    bubble?.setState(FloOrb.State.ERROR, FloOrb.RED)
    bubble?.caption(msg, 3200, Color.parseColor("#FFE4E4"))
    bubble?.haptic(REJECT)
    tone(ToneGenerator.TONE_PROP_NACK)
    main.removeCallbacks(backToIdle)
    main.postDelayed(backToIdle, 1700)
  }

  /** Opens the microphone for [mode]. Returns false (saying why) if it can't. */
  private fun startListening(mode: String, hold: Boolean): Boolean {
    if (SystemClock.uptimeMillis() - lastStopAt < 380) return false // a quick second tap after stopping
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      fail("Open Flo and allow the microphone.")
      return false
    }
    if (mode == "ask" && (Prefs.server(this) == null || Prefs.token(this) == null)) {
      fail("Pair Flo with your computer first to ask.")
      return false
    }
    stopRecognizer()
    cancelAsk() // a new question or dictation replaces whatever the island was showing
    island?.dismiss()
    main.removeCallbacks(backToIdle)
    online = FloNet.online(this)
    offlineSpeech = !online || SystemClock.uptimeMillis() < deviceUntil
    val choice = FloSpeech.create(this, cfg, offlineSpeech)
    if (choice == null) {
      fail("Speech recognition isn't available. Install or update Speech Services by Google.")
      return false
    }
    val r = choice.recognizer
    recognizer = r
    onDevice = choice.onDevice
    listening = mode
    holding = hold
    heard = ""
    acc.setLength(0)
    // you decide when it ends: while holding, or with "tap again to stop"
    continuous = hold || cfg.stopOn == "tap"
    stopping = false
    sessionStart = SystemClock.uptimeMillis()
    emptyRuns = 0
    formatting = cfg.punctuation && !formattingRefused
    formattingRetried = false
    bubble?.setState(FloOrb.State.LISTENING, modeColor(mode))
    bubble?.haptic(HapticFeedbackConstants.VIRTUAL_KEY)
    tone(ToneGenerator.TONE_PROP_BEEP)
    if (cfg.preview) {
      bubble?.caption(
        when {
          offlineSpeech && onDevice -> "Listening on this phone (offline)"
          mode == "ask" -> "Ask Flo anything"
          hold -> "Listening. Let go when done"
          else -> "Listening. Tap to stop"
        },
      )
    }
    r.setRecognitionListener(object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) {}
      override fun onBeginningOfSpeech() {}
      override fun onRmsChanged(rmsdB: Float) {
        if (recognizer === r) bubble?.level(rmsdB)
      }
      override fun onBufferReceived(buffer: ByteArray?) {}
      override fun onEndOfSpeech() {
        // stops at a pause: the recognizer heard you stop; it will deliver the result next
        if (recognizer === r && !continuous) bubble?.setState(FloOrb.State.THINKING, modeColor(mode))
      }
      override fun onEvent(eventType: Int, params: Bundle?) {}
      override fun onPartialResults(b: Bundle?) {
        if (recognizer !== r) return
        b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() }?.let {
          heard = it
          if (cfg.preview) bubble?.caption(joined(it))
        }
      }
      override fun onResults(b: Bundle?) {
        if (recognizer !== r) return
        val text = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() } ?: heard
        main.post { segmentDone(r, mode, text) }
      }
      override fun onError(error: Int) {
        if (recognizer !== r) return
        failed(r, mode, error)
      }
    })
    if (!beginSession(r)) {
      listening = null; stopRecognizer(); fail("Couldn't start the microphone.")
      return false
    }
    return true
  }

  /** One recognizer session (continuous listening chains several). */
  private fun beginSession(r: SpeechRecognizer): Boolean =
    runCatching { r.startListening(FloSpeech.intent(this, cfg, offlineSpeech, continuous, formatting)) }.isSuccess

  /** What was heard in earlier sessions plus [latest]. */
  private fun joined(latest: String = heard): String =
    if (acc.isEmpty()) latest else if (latest.isBlank()) acc.toString() else "$acc $latest"

  /**
   * A session ended with [text]. While you're still holding (or haven't tapped stop) keep listening in
   * a new session, so a pause never cuts you off; after two silent sessions in a row with nothing new
   * (tap mode only), or 5 minutes, stop by itself.
   */
  private fun segmentDone(r: SpeechRecognizer, mode: String, text: String) {
    if (listening != mode || recognizer !== r) return
    if (text.isNotBlank()) {
      if (acc.isNotEmpty()) acc.append(' ')
      acc.append(text.trim())
      emptyRuns = 0
    } else emptyRuns++
    heard = ""
    val longEnough = SystemClock.uptimeMillis() - sessionStart > MAX_LISTEN_MS
    if (continuous && !stopping && !longEnough && (holding || emptyRuns < 2)) {
      if (beginSession(r)) return
    }
    finish(mode, acc.toString())
  }

  /** You let go (or tapped again): stopping makes the recognizer deliver its final result. */
  private fun stopTalking() {
    val mode = listening ?: return
    lastStopAt = SystemClock.uptimeMillis()
    stopping = true
    runCatching { recognizer?.stopListening() }
    bubble?.setState(FloOrb.State.THINKING, modeColor(mode))
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

  private fun failed(r: SpeechRecognizer, mode: String, error: Int) {
    main.post {
      if (listening != mode || recognizer !== r) return@post
      val silence = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
      // a pause between sentences while you keep going: the next session carries on
      if (continuous && !stopping && silence) { segmentDone(r, mode, heard); return@post }
      // a recognizer that can't format this language: ask again without punctuation, once
      if (formatting && !formattingRetried && heard.isBlank() && acc.isEmpty() && FloSpeech.missingPack(error)) {
        formattingRetried = true
        formatting = false
        formattingRefused = true
        if (beginSession(r)) return@post
      }
      if (joined().isNotBlank()) { finish(mode, joined()); return@post }
      val wasOnDevice = onDevice
      listening = null
      stopRecognizer()
      val msg = when {
        FloSpeech.missingPack(error) -> {
          FloNotify.show(this, "Download offline speech", "Flo can type without internet once this language is on your phone. Tap to set it up.", "speech")
          "This language isn't downloaded for offline use. Open Flo, Offline speech."
        }
        FloSpeech.networkError(error) && !wasOnDevice -> {
          deviceUntil = SystemClock.uptimeMillis() + 5 * 60_000L
          if (FloSpeech.onDeviceAvailable(this)) "No connection. Try again: Flo will listen on the phone."
          else "Speech needs the internet on this phone. Open Flo, Offline speech, to download it."
        }
        silence || error == SpeechRecognizer.ERROR_CLIENT -> "Didn't catch that. Try again."
        error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Open Flo and allow the microphone."
        error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "The microphone is busy. Try again."
        else -> "Couldn't hear that. Try again."
      }
      fail(msg)
    }
  }

  /** Tidy what was said (FloCleanup), as you chose. */
  private fun cleaned(raw: String): String =
    if (cfg.cleanup) FloCleanup.clean(raw, cfg.langTag, cfg.punctuation, cfg.words) else raw.trim()

  private fun finish(mode: String, raw: String) {
    main.post {
      if (listening != mode) return@post
      listening = null
      stopRecognizer() // the microphone is closed from here on
      val text = cleaned(raw)
      if (text.isBlank()) { fail("Didn't catch that. Try again."); return@post }
      if (mode == "dictate") {
        val typed = insert(text)
        Prefs.addHistory(this, if (typed) "dictate" else "copied", text)
        done(if (typed) null else "Copied. Paste it anywhere.")
      } else {
        bubble?.caption(null)
        ask(text)
      }
    }
  }

  /** The green check, then back to rest. */
  private fun done(note: String?) {
    bubble?.setState(FloOrb.State.DONE, FloOrb.GREEN)
    bubble?.caption(note, 1800)
    bubble?.haptic(CONFIRM)
    tone(ToneGenerator.TONE_PROP_ACK)
    main.removeCallbacks(backToIdle)
    main.postDelayed(backToIdle, 1100)
  }

  // ── typing into the field ──────────────────────────────────────────────────

  /**
   * Insert at the cursor (or append), fitted to what's around it (a capital after a full stop, a
   * space between words, see FloCleanup.fit); or paste, as you chose.
   */
  private fun insert(raw: String): Boolean {
    val node = target ?: run { copy(raw); return false }
    runCatching { node.refresh() }
    if (cfg.insert == "paste") {
      copy(raw)
      if (node.performAction(AccessibilityNodeInfo.ACTION_PASTE)) return true
    }
    val showingHint = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && node.isShowingHintText
    val current = if (showingHint) "" else node.text?.toString() ?: ""
    var start = node.textSelectionStart
    var end = node.textSelectionEnd
    if (start < 0 || end < 0 || start > current.length || end > current.length) { start = current.length; end = current.length }
    if (start > end) { val t = start; start = end; end = t }
    val before = current.substring(0, start)
    val after = current.substring(end)
    val piece = if (cfg.cleanup) {
      FloCleanup.fit(raw, before, after)
    } else {
      (if (before.isNotEmpty() && !before.last().isWhitespace()) " " else "") + raw.trim()
    }
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
    copy(raw)
    return cfg.insert != "paste" && node.performAction(AccessibilityNodeInfo.ACTION_PASTE)
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

  /** Offline (or Flo's server unreachable): keep the question and say when it'll be answered. */
  private fun keepForLater(question: String, screen: String?) {
    Prefs.enqueue(this, question, screen)
    Prefs.addHistory(this, "queued", question)
    askCancel = null
    bubble?.setState(FloOrb.State.IDLE)
    island?.done("Answers when online", R.drawable.flo_ic_clock, "ask")
    bubble?.caption("You're offline. Flo will answer when you're back online.", 3200)
    bubble?.haptic(CONFIRM)
  }

  private fun ask(question: String) {
    val server = Prefs.server(this) ?: return
    val token = Prefs.token(this) ?: return
    val screen = askScreen ?: readScreen() // the recognizer ended before you let go
    askScreen = null
    cancelAsk()
    if (!FloNet.online(this)) { keepForLater(question, screen); return }
    val cancel = AtomicBoolean(false)
    askCancel = cancel
    island?.askPending(question)
    bubble?.setState(FloOrb.State.THINKING, modeColor("ask"))
    io.execute {
      var sentId: String? = null
      val result = runCatching {
        // waiting: the server's reason the computer hasn't answered yet (may change while we wait)
        FloAsk(server, token).ask(
          question, screen,
          waiting = { msg -> main.post { if (!cancel.get()) island?.askStatus(msg) } },
          cancelled = { cancel.get() },
          sent = { id -> sentId = id },
        )
      }
      main.post {
        if (cancel.get()) return@post
        result.onSuccess { a ->
          Prefs.addHistory(this, "ask", question, a.text, a.cloud)
          // type the answer straight into the field you were in; show it with Insert / Copy only
          // when the field can't take it (closed, or an app that ignores typing)
          if (target != null && insert(a.text)) {
            askCancel = null
            island?.done(if (a.cloud) "Inserted (cloud)" else "Inserted", R.drawable.flo_ic_check, "ask")
            done(null)
          } else {
            island?.askAnswer(a.text, fromCloud = a.cloud)
            bubble?.setState(FloOrb.State.IDLE)
          }
        }.onFailure { e ->
          if (e is FloAsk.Offline) { keepForLater(question, screen); return@post }
          val id = sentId
          val msg = e.message?.takeIf { it.isNotBlank() } ?: "Something went wrong. Try again."
          if (id != null) {
            // it is on the server: the answer can still come; the app shows it when it does
            Prefs.addLate(this, id, question)
            island?.askError("$msg Flo will show the answer in the app if it comes.")
          } else {
            island?.askError(msg)
          }
          Prefs.addHistory(this, "error", question, msg)
          fail("Flo couldn't answer this time.")
        }
      }
    }
  }

  /** Send questions kept while offline, one at a time; answers arrive as notifications. */
  private fun flush() {
    if (Prefs.queueSize(this) == 0) return
    val server = Prefs.server(this) ?: return
    val token = Prefs.token(this) ?: return
    if (!flushing.compareAndSet(false, true)) return
    bg.execute {
      try {
        while (!destroyed.get() && FloNet.online(this)) {
          val item = Prefs.takeNext(this) ?: break
          val q = item.optString("text").takeIf { it.isNotBlank() } ?: continue
          var sentId: String? = null
          try {
            val a = FloAsk(server, token).ask(q, item.optString("screen").takeIf { it.isNotBlank() }, waiting = {}, cancelled = { destroyed.get() }, sent = { sentId = it })
            Prefs.addHistory(this, "ask", q, a.text, a.cloud)
            FloNotify.show(this, "Flo answered: ${q.take(60)}", a.text, "bubble")
          } catch (e: FloAsk.Offline) {
            Prefs.requeue(this, item)
            break
          } catch (e: Exception) {
            val id = sentId
            if (id != null) Prefs.addLate(this, id, q)
            val msg = e.message?.takeIf { it.isNotBlank() } ?: "Flo couldn't answer."
            Prefs.addHistory(this, "error", q, msg)
            if (!destroyed.get()) FloNotify.show(this, "Flo couldn't answer yet", "\"${q.take(80)}\": $msg", "bubble")
          }
        }
      } finally {
        flushing.set(false)
      }
    }
  }

  private companion object {
    const val SYSTEM_UI = "com.android.systemui"
    /** Connected this soon after boot = Android started us after a restart. */
    const val BOOT_WINDOW_MS = 4 * 60_000L
    /** Continuous listening stops by itself after this long. */
    const val MAX_LISTEN_MS = 5 * 60_000L
    /** Android 11+ has distinct confirm / reject haptics; older phones get the nearest ones. */
    val CONFIRM: Int = if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.KEYBOARD_TAP
    val REJECT: Int = if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
  }
}
