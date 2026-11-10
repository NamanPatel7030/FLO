package expo.modules.flobubble

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import kotlin.math.max

/**
 * The island's little live indicator. Bars mode follows the microphone level (redrawn only when the
 * recognizer reports a new level, so no timers); pulse mode is a breathing dot while Flo works, and
 * its animator only runs while that state is on screen.
 */
internal class FloWave(ctx: Context) : View(ctx) {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val rect = RectF()
  private val shape = floatArrayOf(0.55f, 0.9f, 1f, 0.7f)
  private var offset = 0
  private var level = 0f
  private var pulsing = false
  private var phase = 0f
  private var anim: ValueAnimator? = null

  fun bars(color: Int) {
    stop()
    pulsing = false
    paint.color = color
    level = 0f
    invalidate()
  }

  fun pulse(color: Int) {
    paint.color = color
    pulsing = true
    if (anim == null) {
      anim = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 650
        repeatMode = ValueAnimator.REVERSE
        repeatCount = ValueAnimator.INFINITE
        addUpdateListener { a ->
          phase = a.animatedValue as Float
          invalidate()
        }
        start()
      }
    }
  }

  fun stop() {
    anim?.cancel()
    anim = null
  }

  /** [rmsdB] from SpeechRecognizer.onRmsChanged, roughly -2 (quiet) to 10 (loud). */
  fun level(rmsdB: Float) {
    if (pulsing) return
    val t = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
    level += (t - level) * 0.5f
    offset = (offset + 1) % shape.size
    invalidate()
  }

  override fun onDetachedFromWindow() {
    stop()
    super.onDetachedFromWindow()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val w = width.toFloat()
    val h = height.toFloat()
    if (w <= 0f || h <= 0f) return
    if (pulsing) {
      val r = h * (0.22f + 0.14f * phase)
      paint.alpha = (255 * (0.6f + 0.4f * phase)).toInt()
      canvas.drawCircle(w / 2f, h / 2f, r, paint)
      paint.alpha = 255
      return
    }
    val n = shape.size
    val gap = w * 0.12f
    val bw = (w - gap * (n - 1)) / n
    for (i in 0 until n) {
      val k = shape[(i + offset) % n]
      val bh = max(bw, h * (0.2f + 0.8f * level * k))
      val x = i * (bw + gap)
      rect.set(x, (h - bh) / 2f, x + bw, (h + bh) / 2f)
      canvas.drawRoundRect(rect, bw / 2f, bw / 2f, paint)
    }
  }
}
