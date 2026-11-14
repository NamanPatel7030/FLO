package expo.modules.flobubble

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.Point
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.TextUtils
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * The floating Flo bubble (one small body, see FloOrb) and its two helper windows: the "Hide" target
 * that rises at the bottom while you drag, and a caption beside the bubble (your words as you speak,
 * or a short note like "Copied").
 *
 * - Drag it anywhere; let go and it glides to the nearest edge (or the side you chose), or stays
 *   where you dropped it ("free"), and remembers the spot. Drop it on the Hide target to put it away.
 * - A quick flick away from the edge is the swipe gesture (when it does something).
 * - At rest it fades to your idle opacity and, after your tuck delay, tucks half off the edge. After
 *   your auto-hide time it goes away until the next text field. A touch brings it straight back.
 * - Gestures are reported raw (tap, double-tap, hold start/end, swipe); the service decides what
 *   they do.
 * - Every setting (look, size, colours, side, snapping, timings) applies live: applyConfig.
 *
 * Battery: nothing here runs on a timer except the tuck and auto-hide delays after you let go; there
 * is no redraw while idle (the bubble only animates while listening or thinking).
 */
internal class FloBubble(private val ctx: Context, private val wm: WindowManager, private val listener: Listener) {
  interface Listener {
    fun onTap()
    fun onDoubleTap()
    /** A hold began. Return true if the microphone opened. */
    fun onHoldStart(): Boolean
    fun onHoldEnd()
    /** A flick away from the edge. Return true if it did something (else it was just a drag). */
    fun onSwipe(): Boolean
    /** Listening or answering: a tap acts at once (it stops) instead of waiting for a double-tap. */
    fun busy(): Boolean
    /** Dropped on the Hide target. */
    fun onDismiss()
    /** Idle for the auto-hide time. */
    fun onIdle()
  }

  private val main = Handler(Looper.getMainLooper())
  private val slop = ViewConfiguration.get(ctx).scaledTouchSlop
  private val pad = ctx.dp(PAD_DP) // room around the body for the waveform ring and the shadow
  private val edge = ctx.dp(5) // gap between the body and the screen edge

  private var cfg = BubbleConfig()
  private var root: FrameLayout? = null
  private var orb: FloOrb? = null
  private var params: WindowManager.LayoutParams? = null
  private var glide: ValueAnimator? = null
  private var tucked = false

  private var target: View? = null
  private var targetParams: WindowManager.LayoutParams? = null
  private var caption: TextView? = null
  private var captionParams: WindowManager.LayoutParams? = null
  private var offline = false

  private val tuck = Runnable { tuckAway() }
  private val idle = Runnable { if (orb?.state == FloOrb.State.IDLE && !listener.busy()) listener.onIdle() }
  private val hideCaption = Runnable { removeCaption() }

  val isShown: Boolean get() = root != null
  private val body: Pair<Int, Int> get() = FloOrb.bodySize(ctx, cfg.style, cfg.sizeDp)
  private val bodyW: Int get() = body.first
  private val bodyH: Int get() = body.second
  private val winW: Int get() = bodyW + 2 * pad
  private val winH: Int get() = bodyH + 2 * pad

  // ── showing ────────────────────────────────────────────────────────────────

  fun show(c: BubbleConfig) {
    cfg = c
    if (root != null) { scheduleIdle(); return }
    val o = FloOrb(ctx)
    o.configure(cfg.style, bodyW, bodyH, cfg.accent, cfg.accent2)
    o.offline = offline
    o.contentDescription = describe()
    val r = FrameLayout(ctx)
    r.clipChildren = false
    r.addView(o, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    val p = overlayParams(winW, winH).apply {
      gravity = Gravity.TOP or Gravity.START
      flags = flags or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
    }
    place(p)
    if (runCatching { wm.addView(r, p) }.isFailure) return
    root = r; orb = o; params = p; tucked = false
    attachTouch(o)
    if (animationsOn()) {
      o.alpha = 0f; o.scaleX = 0.6f; o.scaleY = 0.6f
      o.animate().alpha(restAlpha()).scaleX(1f).scaleY(1f).setStartDelay(0).setDuration(FloMotion.APPEAR).setInterpolator(floEase()).start()
    } else {
      o.alpha = restAlpha()
    }
    scheduleTuck()
    scheduleIdle()
  }

  fun hide() {
    val r = root ?: return
    glide?.cancel(); glide = null
    main.removeCallbacks(tuck)
    main.removeCallbacks(idle)
    removeTarget()
    removeCaption()
    root = null; orb = null; params = null; tucked = false
    runCatching { wm.removeView(r) }
  }

  /** New settings while showing: look, size, colours, side, snapping, opacity and timings apply at once. */
  fun applyConfig(c: BubbleConfig) {
    val old = cfg
    cfg = c
    val r = root ?: return
    val o = orb ?: return
    val p = params ?: return
    o.configure(cfg.style, bodyW, bodyH, cfg.accent, cfg.accent2)
    o.contentDescription = describe()
    if (old.sizeDp != c.sizeDp || old.style != c.style || old.side != c.side || old.snap != c.snap || old.rememberPosition != c.rememberPosition) {
      glide?.cancel(); glide = null
      p.width = winW; p.height = winH
      untuck(false)
      place(p)
      runCatching { wm.updateViewLayout(r, p) }
      if (caption != null) placeCaption()
    }
    if (o.state == FloOrb.State.IDLE) o.alpha = restAlpha()
    if (!canTuck()) untuck(true) else scheduleTuck()
    scheduleIdle()
  }

  /** After a rotation (or "Reset position" in the app): back on its side at the same relative spot. */
  fun reposition() {
    val r = root ?: return
    val p = params ?: return
    glide?.cancel(); glide = null
    untuck(false)
    place(p)
    runCatching { wm.updateViewLayout(r, p) }
    if (caption != null) placeCaption()
    scheduleTuck()
  }

  fun setState(s: FloOrb.State, color: Int = cfg.accent) {
    val o = orb ?: return
    o.setState(s, color)
    if (s == FloOrb.State.IDLE) {
      o.animate().alpha(restAlpha()).setStartDelay(0).setDuration(220).start()
      scheduleTuck()
      scheduleIdle()
    } else {
      main.removeCallbacks(tuck)
      main.removeCallbacks(idle)
      untuck(true)
      o.animate().alpha(1f).setStartDelay(0).setDuration(120).start()
    }
  }

  fun level(rmsdB: Float) = orb?.level(rmsdB)

  fun setOffline(on: Boolean) {
    offline = on
    orb?.offline = on
  }

  /** A haptic tap, made firmer when you chose strong haptics. */
  fun haptic(kind: Int = HapticFeedbackConstants.KEYBOARD_TAP) {
    if (!cfg.haptics) return
    val k = if (cfg.hapticStrength != "strong") kind else when (kind) {
      HapticFeedbackConstants.KEYBOARD_TAP, HapticFeedbackConstants.CLOCK_TICK -> HapticFeedbackConstants.VIRTUAL_KEY
      HapticFeedbackConstants.VIRTUAL_KEY -> HapticFeedbackConstants.LONG_PRESS
      else -> kind
    }
    orb?.performHapticFeedback(k)
  }

  private fun restAlpha() = cfg.idleOpacity

  private fun canTuck() = cfg.tuck && cfg.docked

  private fun describe(): String {
    fun say(a: String?) = when (a) {
      "ask" -> "ask Flo"
      "dictate" -> "dictate"
      "openFlo" -> "open Flo"
      "hide" -> "hide the bubble"
      else -> null
    }
    val parts = listOfNotNull(
      say(cfg.action("tap"))?.let { "Tap to $it" },
      say(cfg.action("longPress"))?.let { "hold to $it" },
      say(cfg.action("doubleTap"))?.let { "double-tap to $it" },
    )
    return "Flo bubble. " + parts.joinToString(", ").ifEmpty { "Drag to move" }
  }

  // ── position ───────────────────────────────────────────────────────────────

  private fun rightSide(): Boolean = when (cfg.side) {
    "left" -> false
    "right" -> true
    else -> if (cfg.rememberPosition) Prefs.dockRight(ctx) else true
  }

  /** x for the body resting on a side: the window overhangs the edge so the body sits [edge] from it. */
  private fun restX(right: Boolean, screen: Point) = if (right) screen.x - winW + pad - edge else -pad + edge

  private fun clampX(x: Int, screen: Point): Int {
    val lo = -pad + edge
    return x.coerceIn(lo, max(lo, screen.x - winW + pad - edge))
  }

  private fun place(p: WindowManager.LayoutParams) {
    val screen = screenSize(wm)
    val fx = if (cfg.rememberPosition) Prefs.dockX(ctx) else -1f
    p.x = if (!cfg.docked && fx >= 0f) clampX((fx * screen.x).roundToInt(), screen) else restX(rightSide(), screen)
    val f = if (cfg.rememberPosition) Prefs.dockY(ctx) else -1f
    val y = if (f < 0f) (screen.y * 0.56f).roundToInt() else (f * screen.y).roundToInt()
    p.y = clampY(y, screen)
  }

  private fun clampY(y: Int, screen: Point): Int {
    val top = ctx.dp(40) - pad
    return y.coerceIn(top, max(top, screen.y - winH - ctx.dp(48) + pad))
  }

  private fun moveTo(x: Int, y: Int) {
    val r = root ?: return
    val p = params ?: return
    if (x == p.x && y == p.y) return // same pixel: skip the window round trip
    p.x = x; p.y = y
    runCatching { wm.updateViewLayout(r, p) }
    if (caption != null) placeCaption()
  }

  /** Glide to the nearest side (or the chosen one, or stay put when free), then remember the spot. */
  private fun settle(remember: Boolean = true) {
    val r = root ?: return
    val p = params ?: return
    val screen = screenSize(wm)
    val right = when (cfg.side) {
      "left" -> false
      "right" -> true
      else -> p.x + winW / 2 > screen.x / 2
    }
    val x0 = p.x
    val y0 = p.y
    val x1 = if (cfg.docked) restX(right, screen) else clampX(p.x, screen)
    val y1 = clampY(p.y, screen)
    if (remember) Prefs.setDock(ctx, right, y1.toFloat() / screen.y, if (cfg.docked) -1f else x1.toFloat() / screen.x)
    haptic()
    glide?.cancel()
    if (!animationsOn() || (x0 == x1 && y0 == y1)) {
      moveTo(x1, y1)
      scheduleTuck()
      return
    }
    // one animator for the whole glide; a frame that lands on the same pixel skips the window update
    glide = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = FloMotion.GLIDE
      interpolator = floEase()
      addUpdateListener { a ->
        val t = a.animatedValue as Float
        if (root !== r) return@addUpdateListener
        moveTo((x0 + (x1 - x0) * t).roundToInt(), (y0 + (y1 - y0) * t).roundToInt())
      }
      start()
    }
    scheduleTuck()
  }

  // ── tuck and auto-hide ─────────────────────────────────────────────────────

  private fun scheduleTuck() {
    main.removeCallbacks(tuck)
    if (canTuck() && root != null) main.postDelayed(tuck, cfg.tuckDelayMs)
  }

  private fun scheduleIdle() {
    main.removeCallbacks(idle)
    if (cfg.autoHideMs > 0 && root != null) main.postDelayed(idle, cfg.autoHideMs)
  }

  /** Slide half off the edge (a view translation: no window traffic, drawn by the render thread). */
  private fun tuckAway() {
    val o = orb ?: return
    if (o.state != FloOrb.State.IDLE || tucked || !canTuck()) return
    tucked = true
    val shift = (bodyW / 2 + edge).toFloat() * (if (rightSide()) 1 else -1)
    if (animationsOn()) o.animate().translationX(shift).setStartDelay(0).setDuration(360).setInterpolator(floEase()).start()
    else o.translationX = shift
  }

  private fun untuck(animate: Boolean) {
    val o = orb ?: return
    if (!tucked && o.translationX == 0f) return
    tucked = false
    if (animate && animationsOn()) o.animate().translationX(0f).setStartDelay(0).setDuration(180).setInterpolator(floEase()).start()
    else { o.animate().cancel(); o.translationX = 0f }
  }

  // ── gestures ───────────────────────────────────────────────────────────────

  @SuppressLint("ClickableViewAccessibility")
  private fun attachTouch(o: FloOrb) {
    val t = Touch()
    o.setOnTouchListener { _, ev -> t.handle(ev) }
    // TalkBack: a double-tap activates the bubble like a tap
    o.setOnClickListener { if (!t.active) listener.onTap() }
  }

  private var pendingTap = false
  private val singleTap = Runnable { pendingTap = false; listener.onTap() }

  private fun tapped() {
    val waits = cfg.tapDelayMs > 0 && cfg.action("doubleTap") != null && !listener.busy()
    when {
      !waits -> { main.removeCallbacks(singleTap); pendingTap = false; listener.onTap() }
      pendingTap -> { main.removeCallbacks(singleTap); pendingTap = false; listener.onDoubleTap() }
      else -> { pendingTap = true; main.postDelayed(singleTap, cfg.tapDelayMs) }
    }
  }

  private inner class Touch {
    var active = false
    private var downX = 0f
    private var downY = 0f
    private var startX = 0
    private var startY = 0
    private var dragging = false
    private var dragAt = 0L
    private var held = false
    private var talking = false
    private var overTarget = false
    private var velocity: VelocityTracker? = null

    private val hold = Runnable {
      if (dragging || root == null) return@Runnable
      held = true
      talking = listener.onHoldStart()
      if (talking) {
        press(1.1f)
        haptic(HapticFeedbackConstants.LONG_PRESS)
      } else press(1f)
    }

    fun handle(ev: MotionEvent): Boolean {
      val p = params ?: return false
      velocity?.addMovement(ev)
      when (ev.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          active = true
          downX = ev.rawX; downY = ev.rawY
          dragging = false; held = false; talking = false; overTarget = false
          velocity?.recycle()
          velocity = VelocityTracker.obtain().also { it.addMovement(ev) }
          main.removeCallbacks(tuck)
          main.removeCallbacks(idle)
          untuck(true)
          orb?.animate()?.alpha(1f)?.setStartDelay(0)?.setDuration(90)?.start()
          press(0.92f)
          main.postDelayed(hold, HOLD_MS)
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = ev.rawX - downX
          val dy = ev.rawY - downY
          if (!dragging && !held && dx * dx + dy * dy > slop.toFloat() * slop) {
            dragging = true
            dragAt = SystemClock.uptimeMillis()
            main.removeCallbacks(hold)
            glide?.cancel(); glide = null
            startX = p.x; startY = p.y
            downX = ev.rawX; downY = ev.rawY
            press(1.06f)
            showTarget()
          }
          if (dragging) drag(startX + (ev.rawX - downX).roundToInt(), startY + (ev.rawY - downY).roundToInt())
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          main.removeCallbacks(hold)
          val up = ev.actionMasked == MotionEvent.ACTION_UP
          when {
            dragging && overTarget && up -> { removeTarget(); dismissAnimated() }
            dragging && up && flicked() && listener.onSwipe() -> {
              // a swipe: back to where it rested, without remembering the flick as a new spot
              removeTarget(); press(1f); moveTo(startX, startY); settle(remember = false)
            }
            dragging -> { removeTarget(); press(1f); settle() }
            talking -> { press(1f); listener.onHoldEnd() }
            !held && up -> { press(1f); tapped() }
            else -> press(1f)
          }
          if (!dragging && !talking && orb?.state == FloOrb.State.IDLE) {
            orb?.animate()?.alpha(restAlpha())?.setStartDelay(600)?.setDuration(260)?.start()
            scheduleTuck()
          }
          scheduleIdle()
          velocity?.recycle(); velocity = null
          dragging = false; held = false; talking = false
          main.post { active = false }
        }
      }
      return true
    }

    /** A short, fast throw away from the edge it rests on (toward the middle of the screen). */
    private fun flicked(): Boolean {
      val v = velocity ?: return false
      if (SystemClock.uptimeMillis() - dragAt > FLICK_MS) return false
      v.computeCurrentVelocity(1000)
      val vx = v.xVelocity
      val vy = v.yVelocity
      val screen = screenSize(wm)
      val onRight = startX + winW / 2 > screen.x / 2
      val inward = if (onRight) -vx else vx
      return inward > ctx.dp(FLICK_DP_S) && abs(vx) > 1.4f * abs(vy)
    }

    /** Follow the finger; near the Hide target, snap onto it. */
    private fun drag(x: Int, y: Int) {
      val tp = targetParams
      val t = target
      if (tp != null && t != null && t.width > 0) {
        val tcx = tp.x + t.width / 2f
        val tcy = tp.y + ctx.dp(TARGET_DP) / 2f + ctx.dp(6)
        val near = hypot(x + winW / 2f - tcx, y + winH / 2f - tcy) < ctx.dp(84)
        if (near != overTarget) {
          overTarget = near
          haptic(if (near) HapticFeedbackConstants.LONG_PRESS else HapticFeedbackConstants.KEYBOARD_TAP)
          t.animate().scaleX(if (near) 1.18f else 1f).scaleY(if (near) 1.18f else 1f).setDuration(140).setInterpolator(floEase()).start()
        }
        if (near) { moveTo((tcx - winW / 2f).roundToInt(), (tcy - winH / 2f).roundToInt()); return }
      }
      moveTo(x, y)
    }

    private fun press(s: Float) {
      orb?.animate()?.scaleX(s)?.scaleY(s)?.setStartDelay(0)?.setDuration(120)?.setInterpolator(floEase())?.start()
    }
  }

  private fun dismissAnimated() {
    val o = orb ?: return
    if (!animationsOn()) { listener.onDismiss(); return }
    o.animate().scaleX(0.2f).scaleY(0.2f).alpha(0f).setStartDelay(0).setDuration(200).setInterpolator(floEase())
      .withEndAction { listener.onDismiss() }.start()
  }

  // ── the Hide target ────────────────────────────────────────────────────────

  private fun showTarget() {
    if (target != null) return
    val col = LinearLayout(ctx)
    col.orientation = LinearLayout.VERTICAL
    col.gravity = Gravity.CENTER_HORIZONTAL
    col.setPadding(0, ctx.dp(6), 0, 0)
    val circle = FrameLayout(ctx)
    circle.background = GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(Color.parseColor("#B30B1220"))
      setStroke(ctx.dp(1), Color.argb(70, 255, 255, 255))
    }
    circle.elevation = ctx.dp(6).toFloat()
    circle.addView(ctx.iconView(R.drawable.flo_ic_close, Color.WHITE, null), FrameLayout.LayoutParams(ctx.dp(22), ctx.dp(22), Gravity.CENTER))
    col.addView(circle, LinearLayout.LayoutParams(ctx.dp(TARGET_DP), ctx.dp(TARGET_DP)))
    val label = TextView(ctx)
    label.text = "Hide"
    label.textSize = 12f
    label.typeface = MEDIUM
    label.setTextColor(Color.WHITE)
    label.setShadowLayer(ctx.dp(3).toFloat(), 0f, 0f, Color.argb(160, 0, 0, 0))
    label.setPadding(0, ctx.dp(6), 0, 0)
    col.addView(label, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))

    val screen = screenSize(wm)
    val w = ctx.dp(TARGET_DP + 40)
    val p = overlayParams(w, WindowManager.LayoutParams.WRAP_CONTENT).apply {
      gravity = Gravity.TOP or Gravity.START
      flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
      x = (screen.x - w) / 2
      y = screen.y - ctx.dp(TARGET_DP + 120)
    }
    if (runCatching { wm.addView(col, p) }.isFailure) return
    target = col; targetParams = p
    if (animationsOn()) {
      col.alpha = 0f; col.translationY = ctx.dp(24).toFloat()
      col.animate().alpha(1f).translationY(0f).setDuration(FloMotion.APPEAR).setInterpolator(floEase()).start()
    }
  }

  private fun removeTarget() {
    val t = target ?: return
    target = null; targetParams = null
    if (!animationsOn()) { runCatching { wm.removeView(t) }; return }
    t.animate().alpha(0f).translationY(ctx.dp(16).toFloat()).setDuration(FloMotion.DISMISS).setInterpolator(floEase())
      .withEndAction { runCatching { wm.removeView(t) } }.start()
  }

  // ── the caption ────────────────────────────────────────────────────────────

  /**
   * Show [text] beside the bubble (latest words kept when it's long). [holdMs] > 0 hides it after
   * that long; 0 keeps it until the next call. Null hides it.
   */
  fun caption(text: String?, holdMs: Long = 0L, color: Int = Color.WHITE) {
    main.removeCallbacks(hideCaption)
    if (text.isNullOrBlank() || root == null) { removeCaption(); return }
    val tv = caption ?: buildCaption() ?: return
    tv.text = text
    tv.setTextColor(color)
    placeCaption()
    if (holdMs > 0) main.postDelayed(hideCaption, holdMs)
  }

  private fun buildCaption(): TextView? {
    val tv = TextView(ctx)
    tv.textSize = 13f
    tv.typeface = MEDIUM
    tv.maxLines = 3
    tv.ellipsize = TextUtils.TruncateAt.START
    tv.setLineSpacing(0f, 1.1f)
    tv.setPadding(ctx.dp(12), ctx.dp(8), ctx.dp(12), ctx.dp(8))
    tv.background = roundRect(Color.parseColor("#EB0B1220"), ctx.dp(14).toFloat())
    tv.elevation = ctx.dp(4).toFloat()
    tv.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    val p = overlayParams(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT).apply {
      gravity = Gravity.TOP or Gravity.START
      flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
    }
    if (runCatching { wm.addView(tv, p) }.isFailure) return null
    caption = tv; captionParams = p
    if (animationsOn()) { tv.alpha = 0f; tv.animate().alpha(1f).setDuration(FloMotion.FADE_IN).start() }
    return tv
  }

  /** Beside the bubble, toward the middle of the screen, vertically centred on it. */
  private fun placeCaption() {
    val tv = caption ?: return
    val cp = captionParams ?: return
    val p = params ?: return
    val screen = screenSize(wm)
    val maxW = (screen.x * 0.62f).roundToInt().coerceAtMost(ctx.dp(280))
    tv.measure(
      View.MeasureSpec.makeMeasureSpec(maxW, View.MeasureSpec.AT_MOST),
      View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
    )
    val w = tv.measuredWidth
    val h = tv.measuredHeight
    val bodyLeft = p.x + pad
    val bodyRight = p.x + pad + bodyW
    val right = p.x + winW / 2 > screen.x / 2
    val gap = ctx.dp(10)
    val x = (if (right) bodyLeft - gap - w else bodyRight + gap).coerceIn(ctx.dp(8), max(ctx.dp(8), screen.x - w - ctx.dp(8)))
    val y = (p.y + winH / 2 - h / 2).coerceIn(ctx.dp(24), max(ctx.dp(24), screen.y - h - ctx.dp(24)))
    if (cp.x == x && cp.y == y && cp.width == w && cp.height == h) return
    cp.x = x; cp.y = y; cp.width = w; cp.height = h
    runCatching { wm.updateViewLayout(tv, cp) }
  }

  private fun removeCaption() {
    main.removeCallbacks(hideCaption)
    val tv = caption ?: return
    caption = null; captionParams = null
    if (!animationsOn()) { runCatching { wm.removeView(tv) }; return }
    tv.animate().alpha(0f).setDuration(FloMotion.FADE_OUT + 60).withEndAction { runCatching { wm.removeView(tv) } }.start()
  }

  private companion object {
    /** Room around the body, in dp (bubbleSettings.ts ORB_PAD). */
    const val PAD_DP = 13
    /** A still finger for this long starts a hold. */
    const val HOLD_MS = 320L
    const val TARGET_DP = 58
    /** A flick: let go within this long of starting to move ... */
    const val FLICK_MS = 260L
    /** ... at least this fast (dp per second) away from the edge. */
    const val FLICK_DP_S = 900
  }
}
