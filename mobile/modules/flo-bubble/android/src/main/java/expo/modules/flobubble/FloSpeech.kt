package expo.modules.flobubble

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Speech to text without the internet. Flo uses Android's own recognizers (no model shipped in the
 * app, nothing extra to download from Flo):
 *
 * - Android 12+ with an on-device recognizer (Google's, from "Speech Services by Google"): when the
 *   phone is offline, or the user chose "Always on-device", Flo uses createOnDeviceSpeechRecognizer.
 *   Audio never leaves the phone.
 * - Otherwise the default recognizer, with EXTRA_PREFER_OFFLINE when offline (it then uses its
 *   downloaded "offline speech" packs if it has them).
 * - Android 13+ also tells us which language packs are installed, downloading or downloadable
 *   (checkRecognitionSupport) and can start a pack download (triggerModelDownload). The app's
 *   Offline speech screen shows this and links to the system screen for the rest.
 *
 * Every SpeechRecognizer call must happen on the main thread.
 */
internal object FloSpeech {
  private val main = Handler(Looper.getMainLooper())

  fun onDeviceAvailable(c: Context): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && runCatching { SpeechRecognizer.isOnDeviceRecognitionAvailable(c) }.getOrDefault(false)

  class Choice(val recognizer: SpeechRecognizer, val onDevice: Boolean)

  /** On-device when [offline] or the user wants it (and the phone has one), else the default recognizer. */
  fun create(c: Context, cfg: BubbleConfig, offline: Boolean): Choice? {
    if ((offline || cfg.engine == "device") && onDeviceAvailable(c) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      runCatching { SpeechRecognizer.createOnDeviceSpeechRecognizer(c) }.getOrNull()?.let { return Choice(it, true) }
    }
    if (!SpeechRecognizer.isRecognitionAvailable(c)) return null
    return runCatching { SpeechRecognizer.createSpeechRecognizer(c) }.getOrNull()?.let { Choice(it, false) }
  }

  /** [hold]: push-to-talk (you decide when you're done by letting go, so allow long pauses). */
  fun intent(c: Context, cfg: BubbleConfig, offline: Boolean, hold: Boolean): Intent =
    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, c.packageName)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      val silence = if (hold) 6000L else 2500L
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, silence)
      putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, silence)
      if (offline || cfg.engine == "device") putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
      val tag = cfg.langTag
      if (tag != null) {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, tag)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, tag)
      } else if (Build.VERSION.SDK_INT >= 34 && cfg.langDetect.isNotEmpty()) {
        // Android 14+: let the recognizer switch between the languages you speak (en / hi / gu).
        // Written as the platform's string keys; recognizers that don't know them ignore them.
        val langs = ArrayList(cfg.langDetect)
        putExtra("android.speech.extra.ENABLE_LANGUAGE_DETECTION", true)
        putStringArrayListExtra("android.speech.extra.LANGUAGE_DETECTION_ALLOWED_LANGUAGES", langs)
        putExtra("android.speech.extra.ENABLE_LANGUAGE_SWITCH", "balanced")
        putStringArrayListExtra("android.speech.extra.LANGUAGE_SWITCH_ALLOWED_LANGUAGES", langs)
      }
    }

  /** The recognizer could not run without a language pack (or a network for a pack it lacks). */
  fun missingPack(error: Int): Boolean =
    error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED || error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE

  fun networkError(error: Int): Boolean =
    error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT ||
      error == SpeechRecognizer.ERROR_SERVER || error == SpeechRecognizer.ERROR_SERVER_DISCONNECTED

  /**
   * What this phone can do offline, as JSON for the app (src/lib/offlineSpeech.ts SpeechSupport):
   * {api: full|basic|none, onDevice, installed[], pending[], supported[], online[]}.
   */
  fun support(c: Context, lang: String?, done: (String) -> Unit) {
    main.post {
      val onDevice = onDeviceAvailable(c)
      val base = JSONObject().put("onDevice", onDevice)
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || !onDevice) {
        done(base.put("api", if (onDevice) "basic" else "none").toString())
        return@post
      }
      val r = runCatching { SpeechRecognizer.createOnDeviceSpeechRecognizer(c) }.getOrNull()
      if (r == null) {
        done(base.put("api", "basic").toString()); return@post
      }
      var answered = false
      val finish = { json: String ->
        if (!answered) {
          answered = true
          done(json)
          main.post { runCatching { r.destroy() } }
        }
      }
      val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        if (!lang.isNullOrBlank()) putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
      }
      val ok = runCatching {
        r.checkRecognitionSupport(i, ContextCompat.getMainExecutor(c), object : RecognitionSupportCallback {
          override fun onSupportResult(s: RecognitionSupport) {
            finish(
              base.put("api", "full")
                .put("installed", JSONArray(s.installedOnDeviceLanguages))
                .put("pending", JSONArray(s.pendingOnDeviceLanguages))
                .put("supported", JSONArray(s.supportedOnDeviceLanguages))
                .put("online", JSONArray(s.onlineLanguages))
                .toString(),
            )
          }
          override fun onError(error: Int) {
            finish(base.put("api", "basic").put("error", "code $error").toString())
          }
        })
      }.isSuccess
      if (!ok) finish(base.put("api", "basic").toString())
      // some recognizers never call back: answer anyway
      main.postDelayed({ finish(base.put("api", "basic").put("error", "timeout").toString()) }, 6000)
    }
  }

  /** Android 13+: ask the on-device recognizer to download [lang]. False when the phone can't. */
  fun download(c: Context, lang: String, done: (Boolean) -> Unit) {
    main.post {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || !onDeviceAvailable(c)) {
        done(false); return@post
      }
      val r = runCatching { SpeechRecognizer.createOnDeviceSpeechRecognizer(c) }.getOrNull()
      if (r == null) {
        done(false); return@post
      }
      val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
      }
      val ok = runCatching { r.triggerModelDownload(i) }.isSuccess
      done(ok)
      // the download carries on in the system; let the recognizer go a little later
      main.postDelayed({ runCatching { r.destroy() } }, 15_000)
    }
  }

  /**
   * The system screen where offline speech packs live: the Google app's "Offline speech recognition"
   * where it exists, else voice input settings, else Languages. Returns which one opened.
   */
  fun openSettings(c: Context): String {
    val tries = listOf(
      "google" to Intent().setComponent(
        ComponentName("com.google.android.googlequicksearchbox", "com.google.android.voicesearch.greco3.languagepack.InstallActivity"),
      ),
      "voice" to Intent(Settings.ACTION_VOICE_INPUT_SETTINGS),
      "languages" to Intent(Settings.ACTION_LOCALE_SETTINGS),
      "settings" to Intent(Settings.ACTION_SETTINGS),
    )
    for ((name, i) in tries) {
      if (runCatching { c.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess) return name
    }
    return "none"
  }
}
