package expo.modules.flobubble

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.Point
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * The thumb dock: a small dark pill with two round buttons, Dictate and Ask, that sits low on the
 * screen edge where your thumb already is. Drag it anywhere (grip, background, or a button you move
 * before holding); on release it glides to the nearest side and remembers the spot.
 *
 * Gestures on a button: hold still for [HOLD_MS] to talk, move past the touch slop first to drag,
 * or a quick tap shows a "Hold to..." hint.
 */
internal class FloDock(
  private val ctx: Context,
  private val wm: WindowManager,
  /** Hold started on a button. Return true if the microphone opened. */
  private val onHoldStart: (String) -> Boolean,
  /** The finger came up after a hold that opened the microphone. */
  private val onHoldEnd: (String) -> Unit,
  /** A quick tap on a button (not a hold). */
  private val onTap: (String) -> Unit,
) {
  private val main = Handler(Looper.getMainLooper())
  private val slop = ViewConfiguration.get(ctx).scaledTouchSlop
  private val pad = ctx.dp(10) // room around the pill for its shadow and the lift while dragging

  private var root: FrameLayout? = null
  private var pill: LinearLayout? = null
  private var params: WindowManager.LayoutParams? = null
  private var glide: ValueAnimator? = null

  fun show() {
    if (root != null) return
    val r = build()
    val any = View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
    r.measure(any, any)
    val p = overlayParams(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT).apply {
      gravity = Gravity.TOP or Gravity.START
    }
    place(p, r.measuredWidth, r.measuredHeight)
    runCatching { wm.addView(r, p) }.onSuccess {
      root = r; params = p
      val pl = r.getChildAt(0) as LinearLayout
      pill = pl
      pl.alpha = 0f
      pl.translationX = (if (Prefs.dockRight(ctx)) 1 else -1) * ctx.dp(24).toFloat()
      pl.animate().alpha(1f).translationX(0f).setStartDelay(0).setDuration(180).start()
    }
  }

  fun hide() {
    val r = root ?: return
    glide?.cancel(); glide = null
    main.removeCallbacksAndMessages(null)
    root = null; pill = null; params = null
    runCatching { wm.removeView(r) }
  }

  /** After a rotation: put the dock back on its side at the same relative height. */
  fun reposition() {
    val r = root ?: return
    val p = params ?: return
    glide?.cancel(); glide = null
    place(p, r.width, r.height)
    runCatching { wm.updateViewLayout(r, p) }
  }

  // ── position ───────────────────────────────────────────────────────────────

  /** The saved side and height, or by default the right edge just above where the keyboard sits. */
  private fun place(p: WindowManager.LayoutParams, w: Int, h: Int) {
    val screen = screenSize(wm)
    p.x = if (Prefs.dockRight(ctx)) screen.x - w else 0
    val f = Prefs.dockY(ctx)
    val y = if (f < 0f) (screen.y * 0.62f).roundToInt() - h else (f * screen.y).roundToInt()
    p.y = clampY(y, h, screen)
  }

  private fun clampY(y: Int, h: Int, screen: Point): Int {
    val top = ctx.dp(28)
    return y.coerceIn(top, max(top, screen.y - h - ctx.dp(40)))
  }

  private fun moveTo(x: Int, y: Int, screen: Point) {
    val r = root ?: return
    val p = params ?: return
    p.x = x.coerceIn(0, max(0, screen.x - r.width))
    p.y = y.coerceIn(0, max(0, screen.y - r.height))
    runCatching { wm.updateViewLayout(r, p) }
  }

  /** Glide to the nearest side (and back inside the screen vertically), then remember the spot. */
  private fun settle() {
    val r = root ?: return
    val p = params ?: return
    val screen = screenSize(wm)
    val right = p.x + r.width / 2 > screen.x / 2
    val x0 = p.x
    val y0 = p.y
    val x1 = if (right) screen.x - r.width else 0
    val y1 = clampY(p.y, r.height, screen)
    Prefs.setDock(ctx, right, y1.toFloat() / screen.y)
    r.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
    glide?.cancel()
    glide = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 240
      interpolator = DecelerateInterpolator(1.8f)
      addUpdateListener { a ->
        val t = a.animatedValue as Float
        val rr = root ?: return@addUpdateListener
        val pp = params ?: return@addUpdateListener
        pp.x = (x0 + (x1 - x0) * t).roundToInt()
        pp.y = (y0 + (y1 - y0) * t).roundToInt()
        runCatching { wm.updateViewLayout(rr, pp) }
      }
      start()
    }
  }

  /** A slight lift while dragging. */
  private fun lift(up: Boolean) {
    val pl = pill ?: return
    val s = if (up) 1.06f else 1f
    pl.animate().scaleX(s).scaleY(s).setStartDelay(0).setDuration(120).start()
    pl.elevation = ctx.dp(if (up) 18 else 8).toFloat()
  }

  // ── views ──────────────────────────────────────────────────────────────────

  @SuppressLint("ClickableViewAccessibility")
  private fun build(): FrameLayout {
    val root = FrameLayout(ctx)
    root.setPadding(pad, pad, pad, pad)
    root.clipToPadding = false
    root.clipChildren = false

    val pill = LinearLayout(ctx)
    pill.orientation = LinearLayout.VERTICAL
    pill.gravity = Gravity.CENTER_HORIZONTAL
    pill.background = roundRect(FloColors.DOCK, ctx.dp(34).toFloat())
    pill.setPadding(ctx.dp(8), ctx.dp(4), ctx.dp(8), ctx.dp(10))
    pill.elevation = ctx.dp(8).toFloat()

    val grip = ctx.iconView(R.drawable.flo_ic_grip, FloColors.GRIP, "Drag to move Flo")
    pill.addView(grip, LinearLayout.LayoutParams(ctx.dp(22), ctx.dp(18)).apply { bottomMargin = ctx.dp(2) })

    val dictate = button(R.drawable.flo_ic_mic, FloColors.DICTATE, "Hold to dictate")
    pill.addView(dictate, LinearLayout.LayoutParams(ctx.dp(56), ctx.dp(56)))
    pill.addView(label("Dictate"), LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))

    val ask = button(R.drawable.flo_ic_sparkle, FloColors.ASK, "Hold to ask Flo")
    pill.addView(ask, LinearLayout.LayoutParams(ctx.dp(56), ctx.dp(56)).apply { topMargin = ctx.dp(6) })
    pill.addView(label("Ask"), LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))

    root.addView(pill, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT))

    // the grip, labels and pill background aren't clickable, so their touches land on root: drag only
    val drag = Touch(null, null)
    root.setOnTouchListener { _, ev -> drag.handle(ev) }
    val td = Touch("dictate", dictate)
    dictate.setOnTouchListener { _, ev -> td.handle(ev) }
    val ta = Touch("ask", ask)
    ask.setOnTouchListener { _, ev -> ta.handle(ev) }
    return root
  }

  private fun button(icon: Int, color: Int, desc: String): FrameLayout {
    val b = FrameLayout(ctx)
    b.background = circle(color)
    b.elevation = ctx.dp(2).toFloat()
    b.contentDescription = desc
    b.addView(ctx.iconView(icon, Color.WHITE, null), FrameLayout.LayoutParams(ctx.dp(26), ctx.dp(26), Gravity.CENTER))
    return b
  }

  private fun label(text: String): TextView {
    val t = TextView(ctx)
    t.text = text
    t.textSize = 10.5f
    t.typeface = MEDIUM
    t.setTextColor(FloColors.SOFT)
    t.gravity = Gravity.CENTER
    t.setPadding(0, ctx.dp(3), 0, 0)
    t.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    return t
  }

  // ── gestures ───────────────────────────────────────────────────────────────

  /** One touch on the dock: [mode] is "dictate" / "ask" on a button, null on the pill itself. */
  private inner class Touch(private val mode: String?, private val button: View?) {
    private var downX = 0f
    private var downY = 0f
    private var startX = 0
    private var startY = 0
    private var screen = Point()
    private var dragging = false
    private var held = false
    private var talking = false

    private val hold = Runnable {
      val m = mode ?: return@Runnable
      if (dragging || root == null) return@Runnable
      held = true
      talking = onHoldStart(m)
      if (talking) {
        scale(1.12f)
        button?.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
      } else {
        scale(1f)
      }
    }

    fun handle(ev: MotionEvent): Boolean {
      val p = params ?: return false
      when (ev.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = ev.rawX; downY = ev.rawY
          dragging = false; held = false; talking = false
          if (mode != null) {
            scale(0.94f)
            main.postDelayed(hold, HOLD_MS)
          }
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = ev.rawX - downX
          val dy = ev.rawY - downY
          if (!dragging && !held && dx * dx + dy * dy > slop.toFloat() * slop) {
            dragging = true
            main.removeCallbacks(hold)
            glide?.cancel(); glide = null
            // start from where the dock is now and where the finger is now: no jump
            startX = p.x; startY = p.y
            downX = ev.rawX; downY = ev.rawY
            screen = screenSize(wm)
            scale(1f)
            lift(true)
          }
          if (dragging) moveTo(startX + (ev.rawX - downX).roundToInt(), startY + (ev.rawY - downY).roundToInt(), screen)
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          main.removeCallbacks(hold)
          val m = mode
          when {
            dragging -> { lift(false); settle() }
            talking && m != null -> { scale(1f); onHoldEnd(m) }
            !held && m != null && ev.actionMasked == MotionEvent.ACTION_UP -> { scale(1f); onTap(m) }
            else -> scale(1f)
          }
          dragging = false; held = false; talking = false
        }
      }
      return true
    }

    private fun scale(s: Float) {
      button?.animate()?.scaleX(s)?.scaleY(s)?.setStartDelay(0)?.setDuration(110)?.start()
    }
  }

  private companion object {
    /** How long a still finger must rest on a button before Flo starts listening. */
    const val HOLD_MS = 120L
  }
}
