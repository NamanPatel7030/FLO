package expo.modules.flobubble

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathMeasure
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.SweepGradient
import android.os.SystemClock
import android.view.View
import android.view.ViewOutlineProvider
import android.view.animation.LinearInterpolator
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.min
import kotlin.math.sin

/**
 * The Flo bubble: the Flo wave mark on a deep-blue glass orb with a thin live ring, all drawn on one
 * canvas (no child views, no layout passes while it moves).
 *
 * - Idle: a calm, still ring. Nothing animates and nothing redraws.
 * - Listening: the ring becomes a circular waveform that follows your voice. The recognizer reports
 *   a level ~10-20 times a second; a vsync frame loop (postOnAnimation) eases toward it, so the
 *   spikes never jump. It runs only while listening.
 * - Thinking: a soft comet sweeps around the ring (one linear infinite animator).
 * - Done: a green ring closes and the wave mark turns into a check (one short animator).
 * - Error: a red ring and a small shake (one short animator).
 * - Offline: a small amber pip on the orb, in every state.
 *
 * The orb sits centred in the view with room around it for the waveform and the shadow. With system
 * animations off every state is drawn still.
 */
internal class FloOrb(ctx: Context) : View(ctx) {
  enum class State { IDLE, LISTENING, THINKING, DONE, ERROR }

  var state = State.IDLE
    private set
  private var diameter = ctx.dp(46)
  private var accent = BubbleConfig.DEFAULT_ACCENT
  private var ringColor = accent
  var offline = false
    set(v) {
      if (field != v) { field = v; invalidate() }
    }

  private val body = Paint(Paint.ANTI_ALIAS_FLAG)
  private val glow = Paint(Paint.ANTI_ALIAS_FLAG)
  private val gloss = Paint(Paint.ANTI_ALIAS_FLAG)
  private val rim = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Color.argb(56, 255, 255, 255) }
  private val mark = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
  private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = MARK_LIGHT }
  private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
  private val spike = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
  private val sweep = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
  private val check = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND; color = Color.WHITE }
  private val pip = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = WARN }
  private val pipEdge = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = INK }
  private val tint = Paint(Paint.ANTI_ALIAS_FLAG)

  private val markPath = Path()
  private val checkPath = Path()
  private val checkPart = Path()
  private val checkMeasure = PathMeasure()
  private val arc = RectF()
  private var sweepShaderFor = 0

  // listening
  private var target = 0f
  private var shown = 0f
  private var clock = 0f
  private var lastFrame = 0L
  private var framing = false
  private val frame = object : Runnable {
    override fun run() {
      if (state != State.LISTENING || !isAttachedToWindow) { framing = false; return }
      val now = SystemClock.uptimeMillis()
      val dt = ((now - lastFrame).coerceIn(1L, 64L)) / 1000f
      lastFrame = now
      shown = smoothToward(shown, target, dt, if (target > shown) RISE_S else FALL_S)
      if (animationsOn()) clock += dt
      invalidate()
      postOnAnimation(this)
    }
  }

  // thinking / done / error
  private var phase = 0f
  private var anim: ValueAnimator? = null

  init {
    outlineProvider = object : ViewOutlineProvider() {
      override fun getOutline(view: View, o: Outline) {
        val r = diameter / 2
        o.setOval(width / 2 - r, height / 2 - r, width / 2 + r, height / 2 + r)
      }
    }
    elevation = ctx.dp(6).toFloat()
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
  }

  /** Size (orb diameter in px) and accent; rebuilds the gradients once, not per frame. */
  fun configure(diameterPx: Int, accentColor: Int) {
    if (diameterPx == diameter && accentColor == accent) return
    diameter = diameterPx
    accent = accentColor
    if (state == State.IDLE) ringColor = accent
    rebuild()
    invalidateOutline()
    invalidate()
  }

  /** [color]: the ring colour for this state (the accent, Ask's violet, green, red). */
  fun setState(s: State, color: Int = accent) {
    val changed = s != state || color != ringColor
    state = s
    ringColor = color
    if (!changed && s != State.DONE && s != State.ERROR) return
    stopAnim()
    when (s) {
      State.IDLE -> { stopFrames(); shown = 0f; target = 0f }
      State.LISTENING -> { target = 0f; startFrames() }
      State.THINKING -> { stopFrames(); loop(THINK_MS) }
      State.DONE, State.ERROR -> { stopFrames(); once(if (s == State.DONE) DONE_MS else ERROR_MS) }
    }
    invalidate()
  }

  /** [rmsdB] from SpeechRecognizer.onRmsChanged, roughly -2 (quiet) to 10 (loud). */
  fun level(rmsdB: Float) {
    if (state != State.LISTENING) return
    target = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
    startFrames()
  }

  // ── animation plumbing ─────────────────────────────────────────────────────

  private fun startFrames() {
    if (framing || state != State.LISTENING || !isAttachedToWindow) return
    framing = true
    lastFrame = SystemClock.uptimeMillis()
    postOnAnimation(frame)
  }

  private fun stopFrames() {
    framing = false
    removeCallbacks(frame)
  }

  private fun loop(ms: Long) {
    if (!animationsOn()) { phase = 0.15f; return }
    anim = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = ms
      interpolator = LinearInterpolator()
      repeatCount = ValueAnimator.INFINITE
      addUpdateListener { phase = it.animatedValue as Float; invalidate() }
      start()
    }
  }

  private fun once(ms: Long) {
    if (!animationsOn()) { phase = 1f; return }
    phase = 0f
    anim = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = ms
      interpolator = floEase()
      addUpdateListener { phase = it.animatedValue as Float; invalidate() }
      start()
    }
  }

  private fun stopAnim() {
    anim?.cancel()
    anim = null
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (state == State.LISTENING) startFrames()
  }

  override fun onDetachedFromWindow() {
    stopFrames()
    stopAnim()
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    rebuild()
  }

  // ── drawing ────────────────────────────────────────────────────────────────

  private fun rebuild() {
    if (width == 0 || height == 0) return
    val cx = width / 2f
    val cy = height / 2f
    val r = diameter / 2f
    // deep-blue glass, lit from the top left, with a little of the accent mixed in
    body.shader = RadialGradient(
      cx - r * 0.35f, cy - r * 0.45f, r * 1.45f,
      intArrayOf(mix(ORB_LIGHT, accent, 0.30f), mix(ORB_MID, accent, 0.12f), ORB_DEEP),
      floatArrayOf(0f, 0.55f, 1f), Shader.TileMode.CLAMP,
    )
    glow.shader = RadialGradient(
      cx, cy + r * 0.75f, r * 0.95f,
      intArrayOf(withAlpha(accent, 150), withAlpha(accent, 0)), null, Shader.TileMode.CLAMP,
    )
    gloss.shader = LinearGradient(
      0f, cy - r * 0.92f, 0f, cy - r * 0.05f,
      Color.argb(110, 255, 255, 255), Color.argb(0, 255, 255, 255), Shader.TileMode.CLAMP,
    )
    rim.strokeWidth = context.dp(1).toFloat()

    // the Flo wave mark (desktop app icon): M14 37 c5-14 12-14 18-7 s13 7 18-7, dot at (50,23)
    val k = (r * 1.04f) / 44f
    val m = Matrix().apply { setTranslate(-32f, -27.5f); postScale(k, k); postTranslate(cx, cy + r * 0.04f) }
    markPath.reset()
    markPath.moveTo(14f, 37f)
    markPath.cubicTo(19f, 23f, 26f, 23f, 32f, 30f)
    markPath.cubicTo(38f, 37f, 45f, 37f, 50f, 23f)
    markPath.transform(m)
    mark.strokeWidth = 6.2f * k
    val p0 = floatArrayOf(14f, 37f, 50f, 23f).also { m.mapPoints(it) }
    mark.shader = LinearGradient(p0[0], p0[1], p0[2], p0[3], MARK_LIGHT, mix(MARK_LIGHT, accent, 0.55f), Shader.TileMode.CLAMP)
    dotCx = p0[2]; dotCy = p0[3]; dotR = 3.1f * k

    checkPath.reset()
    checkPath.moveTo(cx - r * 0.36f, cy + r * 0.02f)
    checkPath.lineTo(cx - r * 0.1f, cy + r * 0.28f)
    checkPath.lineTo(cx + r * 0.38f, cy - r * 0.26f)
    checkMeasure.setPath(checkPath, false)
    check.strokeWidth = r * 0.16f

    ring.strokeWidth = context.dp(1.5f).toFloat()
    spike.strokeWidth = context.dp(2).toFloat()
    sweep.strokeWidth = context.dp(2.2f).toFloat()
    pipEdge.strokeWidth = context.dp(1.5f).toFloat()
    sweepShaderFor = 0
  }

  private var dotCx = 0f
  private var dotCy = 0f
  private var dotR = 0f

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (width == 0 || body.shader == null) return
    val cx = width / 2f
    val cy = height / 2f
    val r = diameter / 2f
    val ringR = r + context.dp(3)
    val motion = animationsOn()

    canvas.save()
    if (state == State.ERROR && motion) {
      val p = phase
      canvas.translate(sin(p * 6f * PI.toFloat()) * (1f - p) * context.dp(3), 0f)
    }
    if (state == State.LISTENING) {
      val s = 1f + 0.05f * shown
      canvas.scale(s, s, cx, cy)
    }

    // the orb
    canvas.drawCircle(cx, cy, r, body)
    canvas.drawCircle(cx, cy, r, glow)
    if (state == State.DONE) {
      tint.color = withAlpha(GREEN, (60 * phase).toInt())
      canvas.drawCircle(cx, cy, r, tint)
    }
    arc.set(cx - r * 0.66f, cy - r * 0.9f, cx + r * 0.66f, cy - r * 0.02f)
    canvas.drawOval(arc, gloss)
    canvas.drawCircle(cx, cy, r - rim.strokeWidth / 2f, rim)

    // the mark, or the check it turns into
    val markAlpha = if (state == State.DONE) ((1f - phase * 1.6f).coerceIn(0f, 1f) * 255).toInt() else 255
    if (markAlpha > 0) {
      mark.alpha = markAlpha; dot.alpha = markAlpha
      canvas.drawPath(markPath, mark)
      canvas.drawCircle(dotCx, dotCy, dotR, dot)
    }
    if (state == State.DONE) {
      val t = ((phase - 0.25f) / 0.75f).coerceIn(0f, 1f)
      if (t > 0f) {
        checkPart.reset()
        checkMeasure.getSegment(0f, checkMeasure.length * t, checkPart, true)
        canvas.drawPath(checkPart, check)
      }
    }
    canvas.restore()

    // the ring
    when (state) {
      State.IDLE -> {
        ring.color = withAlpha(ringColor, 150)
        canvas.drawCircle(cx, cy, ringR, ring)
      }
      State.LISTENING -> drawWave(canvas, cx, cy, r + context.dp(2.5f), motion)
      State.THINKING -> {
        ring.color = withAlpha(ringColor, 48)
        canvas.drawCircle(cx, cy, ringR, ring)
        if (sweepShaderFor != ringColor) {
          sweep.shader = SweepGradient(cx, cy, intArrayOf(withAlpha(ringColor, 0), withAlpha(ringColor, 0), ringColor), floatArrayOf(0f, 0.45f, 1f))
          sweepShaderFor = ringColor
        }
        canvas.save()
        canvas.rotate(phase * 360f, cx, cy)
        canvas.drawCircle(cx, cy, ringR, sweep)
        dot.alpha = 255
        tint.color = ringColor
        canvas.drawCircle(cx + ringR, cy, sweep.strokeWidth * 0.9f, tint)
        canvas.restore()
      }
      State.DONE -> {
        ring.color = GREEN
        arc.set(cx - ringR, cy - ringR, cx + ringR, cy + ringR)
        canvas.drawArc(arc, -90f, 360f * min(1f, phase * 1.4f), false, ring)
      }
      State.ERROR -> {
        ring.color = withAlpha(RED, (255 * (0.55f + 0.45f * (1f - phase))).toInt())
        canvas.drawCircle(cx, cy, ringR, ring)
      }
    }

    // offline: a small amber pip at the top right of the orb
    if (offline) {
      val a = (-PI / 4).toFloat()
      val px = cx + cos(a) * r * 0.80f
      val py = cy + sin(a) * r * 0.80f
      val pr = r * 0.19f
      canvas.drawCircle(px, py, pr, pip)
      canvas.drawCircle(px, py, pr, pipEdge)
    }
  }

  /** A ring of short spikes around the orb that rise with your voice and ripple gently. */
  private fun drawWave(canvas: Canvas, cx: Float, cy: Float, r0: Float, motion: Boolean) {
    ring.color = withAlpha(ringColor, 70)
    canvas.drawCircle(cx, cy, r0, ring)
    val maxLen = context.dp(6.5f).toFloat()
    val minLen = context.dp(1.2f).toFloat()
    val t = clock
    for (i in 0 until SPIKES) {
      val a = (i.toFloat() / SPIKES) * 2f * PI.toFloat() - PI.toFloat() / 2f
      val n = if (motion) {
        0.6f * (0.5f + 0.5f * sin(t * 5.6f + i * 0.71f)) + 0.4f * (0.5f + 0.5f * sin(t * 10.7f - i * 1.33f))
      } else 0.6f
      val len = minLen + maxLen * shown * (0.25f + 0.75f * n)
      spike.color = withAlpha(ringColor, (120 + 135 * (0.3f + 0.7f * shown * n)).toInt().coerceAtMost(255))
      val ca = cos(a)
      val sa = sin(a)
      canvas.drawLine(cx + ca * r0, cy + sa * r0, cx + ca * (r0 + len), cy + sa * (r0 + len), spike)
    }
  }

  companion object {
    private const val SPIKES = 44
    const val THINK_MS = 1100L
    const val DONE_MS = 520L
    const val ERROR_MS = 460L
    private const val RISE_S = 0.06f
    private const val FALL_S = 0.16f

    val ORB_LIGHT: Int = Color.parseColor("#3D5BD9")
    val ORB_MID: Int = Color.parseColor("#16237A")
    val ORB_DEEP: Int = Color.parseColor("#070C2C")
    val MARK_LIGHT: Int = Color.parseColor("#E9F7FF")
    val GREEN: Int = Color.parseColor("#34D399")
    val RED: Int = Color.parseColor("#F87171")
    val WARN: Int = Color.parseColor("#FBBF24")
    val INK: Int = Color.parseColor("#0B1220")

    fun smoothToward(cur: Float, target: Float, dt: Float, tau: Float): Float = cur + (target - cur) * (1f - exp(-dt / tau))

    fun withAlpha(c: Int, a: Int): Int = Color.argb(a.coerceIn(0, 255), Color.red(c), Color.green(c), Color.blue(c))

    fun mix(a: Int, b: Int, t: Float): Int = Color.rgb(
      (Color.red(a) + (Color.red(b) - Color.red(a)) * t).toInt(),
      (Color.green(a) + (Color.green(b) - Color.green(a)) * t).toInt(),
      (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * t).toInt(),
    )
  }
}
