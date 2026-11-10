package expo.modules.flobubble

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.os.SystemClock
import android.view.View
import android.view.animation.LinearInterpolator
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.sin

/**
 * The island's little live indicator, drawn on its own canvas (no layout passes while it moves).
 *
 * - Bars ([bars]): four bars that follow the microphone. The recognizer reports a level only ~10-20
 *   times a second, so [level] just sets a target; a frame callback (postOnAnimation, i.e. the
 *   display's vsync: 60/90/120 Hz) eases the drawn level toward it with exponential smoothing and
 *   gives each bar a slow sine sway, so nothing jumps. The frame loop runs only while Listening.
 * - Dots ([dots]): three dots that rise and brighten in a travelling wave while Flo works. One
 *   infinite ValueAnimator with a linear phase (0..1, no reversing, no easing seams) drives all
 *   three with phase offsets, and it runs only while that state is on screen.
 *
 * When the system has animations turned off, dots are drawn still and bars follow the level without
 * the sway. [stop] (or leaving the window) ends every callback, so an idle island costs nothing.
 */
internal class FloWave(ctx: Context) : View(ctx) {
  private enum class Mode { NONE, BARS, DOTS }

  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val rect = RectF()
  private var mode = Mode.NONE

  // bars
  private var target = 0f
  private var shown = 0f
  private var sway = 0f // seconds of sway, advanced per frame
  private var lastFrame = 0L
  private var framing = false
  private val frame = object : Runnable {
    override fun run() {
      if (mode != Mode.BARS || !isAttachedToWindow) { framing = false; return }
      val now = SystemClock.uptimeMillis()
      val dt = ((now - lastFrame).coerceIn(1L, 64L)) / 1000f
      lastFrame = now
      shown = smoothToward(shown, target, dt, if (target > shown) RISE_S else FALL_S)
      if (motion) sway += dt
      invalidate()
      postOnAnimation(this)
    }
  }

  // dots
  private var phase = 0f
  private var anim: ValueAnimator? = null

  private val motion: Boolean get() = animationsOn()

  /** Listening: bars that follow [level]. */
  fun bars(color: Int) {
    stopDots()
    paint.color = color
    if (mode != Mode.BARS) { target = 0f; shown = 0f; sway = 0f }
    mode = Mode.BARS
    startFrames()
    invalidate()
  }

  /** Working ("Thinking" / "Typing"): the travelling three-dot wave. */
  fun dots(color: Int) {
    stopFrames()
    paint.color = color
    mode = Mode.DOTS
    if (anim == null && motion) {
      anim = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = DOTS_MS
        interpolator = LinearInterpolator()
        repeatCount = ValueAnimator.INFINITE
        repeatMode = ValueAnimator.RESTART
        addUpdateListener { a ->
          phase = a.animatedValue as Float
          invalidate()
        }
        start()
      }
    }
    invalidate()
  }

  fun stop() {
    mode = Mode.NONE
    stopFrames()
    stopDots()
  }

  /** [rmsdB] from SpeechRecognizer.onRmsChanged, roughly -2 (quiet) to 10 (loud). */
  fun level(rmsdB: Float) {
    if (mode != Mode.BARS) return
    target = levelOf(rmsdB)
    startFrames()
  }

  private fun startFrames() {
    if (framing || mode != Mode.BARS || !isAttachedToWindow) return
    framing = true
    lastFrame = SystemClock.uptimeMillis()
    postOnAnimation(frame)
  }

  private fun stopFrames() {
    framing = false
    removeCallbacks(frame)
  }

  private fun stopDots() {
    anim?.cancel()
    anim = null
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    when (mode) {
      Mode.BARS -> startFrames()
      Mode.DOTS -> if (anim == null) dots(paint.color)
      Mode.NONE -> Unit
    }
  }

  override fun onDetachedFromWindow() {
    stopFrames()
    stopDots()
    super.onDetachedFromWindow()
  }

  override fun onVisibilityChanged(changedView: View, visibility: Int) {
    super.onVisibilityChanged(changedView, visibility)
    if (visibility != VISIBLE) { stopFrames(); stopDots() }
    else if (mode == Mode.BARS) startFrames()
    else if (mode == Mode.DOTS && anim == null) dots(paint.color)
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val w = width.toFloat()
    val h = height.toFloat()
    if (w <= 0f || h <= 0f) return
    when (mode) {
      Mode.DOTS -> drawDots(canvas, w, h)
      Mode.BARS -> drawBars(canvas, w, h)
      Mode.NONE -> Unit
    }
  }

  private fun drawDots(canvas: Canvas, w: Float, h: Float) {
    val r = h * 0.13f
    val gap = (w - 6 * r) / 2f
    val step = 2 * r + gap * 0.5f
    val cx0 = w / 2f - step
    val base = paint.alpha
    for (i in 0 until 3) {
      // 0..1 bump that travels left to right: one smooth sine per cycle, offset per dot
      val k = if (motion) dotWave(phase, i) else 0.5f
      paint.alpha = (base * (0.45f + 0.55f * k)).toInt()
      canvas.drawCircle(cx0 + i * step, h / 2f - k * h * 0.16f, r * (0.85f + 0.25f * k), paint)
    }
    paint.alpha = base
  }

  private fun drawBars(canvas: Canvas, w: Float, h: Float) {
    val n = SHAPE.size
    val gap = w * 0.12f
    val bw = (w - gap * (n - 1)) / n
    for (i in 0 until n) {
      val k = SHAPE[i] * (0.82f + 0.18f * sin(sway * 2f * PI.toFloat() * 1.1f + i * 1.7f))
      val bh = max(bw, h * (0.2f + 0.8f * shown * k))
      val x = i * (bw + gap)
      rect.set(x, (h - bh) / 2f, x + bw, (h + bh) / 2f)
      canvas.drawRoundRect(rect, bw / 2f, bw / 2f, paint)
    }
  }

  companion object {
    private val SHAPE = floatArrayOf(0.6f, 0.95f, 1f, 0.72f)
    const val DOTS_MS = 1100L
    /** Time constants for the level: quick to rise with your voice, gentler to fall. */
    const val RISE_S = 0.06f
    const val FALL_S = 0.14f

    /** Microphone level → 0..1. */
    fun levelOf(rmsdB: Float): Float = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)

    /** Frame-rate independent exponential smoothing: the same feel at 60 or 120 Hz. */
    fun smoothToward(cur: Float, target: Float, dt: Float, tau: Float): Float =
      cur + (target - cur) * (1f - exp(-dt / tau))

    /** Dot [i]'s height (0..1) at [phase] (0..1): one smooth bump per cycle, each dot a sixth of a cycle behind the last. */
    fun dotWave(phase: Float, i: Int): Float {
      val p = phase - i / 6f
      return 0.5f - 0.5f * kotlin.math.cos(2f * PI.toFloat() * p)
    }
  }
}
