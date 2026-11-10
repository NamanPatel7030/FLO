package expo.modules.flobubble

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Point
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewOutlineProvider
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The island: a black capsule at the top of the screen, over the camera cutout, that shows what Flo
 * is doing ("Listening" with a live level, "Thinking", "Typing", "Typed"). For Ask it morphs into a
 * black answer card with Insert / Copy / Close. The controls themselves stay in the thumb dock; the
 * island only shows status, and tapping it while an Ask is pending opens the card.
 *
 * Its window never takes focus (the keyboard stays up) but is touchable so the card's buttons work.
 *
 * How it stays smooth: resizing an overlay window is expensive (a WindowManager round trip and a
 * new surface), so the window is resized at most twice per morph: grown to fit the larger of the
 * two shapes when a morph starts, and trimmed to the final shape when it ends. In between, the
 * black shape is the capsule's *outline* (a rounded rect that clips the capsule), and the compact
 * row's two halves ride its edges with translationX. Each frame only invalidates the outline and
 * moves two views: no measure or layout pass. Widths keep the screen's parity so the shape is
 * centered to the exact pixel and never shifts sideways. Text and indicator swaps cross-fade.
 */
internal class FloIsland(private val ctx: Context, private val wm: WindowManager) {
  var onClose: () -> Unit = {}
  var onInsert: (String) -> Unit = {}
  var onCopy: (String) -> Unit = {}

  private enum class Indicator { BARS, DOTS, ICON }

  private val main = Handler(Looper.getMainLooper())
  private val autoHide = Runnable { dismiss() }

  private var root: FrameLayout? = null
  private var params: WindowManager.LayoutParams? = null
  private lateinit var capsule: FrameLayout
  private lateinit var compact: LinearLayout
  private lateinit var slot: FrameLayout
  private lateinit var wave: FloWave
  private lateinit var badge: ImageView
  private lateinit var label: TextView
  private lateinit var card: LinearLayout
  private lateinit var question: TextView
  private lateinit var body: TextView
  private lateinit var scroll: ScrollView
  private lateinit var actions: LinearLayout

  private var morph: ValueAnimator? = null
  // the shape being drawn right now (px); the window is always at least this big
  private var curW = 0f
  private var curH = 0f
  private var curR = 0f
  private var compactH = 0
  private var topY = 0
  private var centerGap = 0
  private var expanded = false
  private var asking = false // an Ask is pending or answered: the card belongs to it
  private var answer: String? = null
  // what the compact row shows (or is fading to)
  private var shownText = ""
  private var shownKey = ""
  private var swapSeq = 0

  // ── what the dock and the service call ─────────────────────────────────────

  fun listening(mode: String) {
    asking = false; answer = null
    setCompact("Listening", FloColors.forMode(mode), Indicator.BARS)
  }

  fun level(rmsdB: Float) {
    if (root != null && !expanded) wave.level(rmsdB)
  }

  /** After you let go: "Typing" for Dictate, "Thinking" for Ask. */
  fun working(mode: String) {
    setCompact(if (mode == "ask") "Thinking" else "Typing", FloColors.forMode(mode), Indicator.DOTS)
  }

  /** A short confirmation ("Typed", "Copied", "Inserted") that then tucks away. */
  fun done(text: String, icon: Int, mode: String) {
    asking = false; answer = null
    setCompact(text, FloColors.forMode(mode), Indicator.ICON, icon)
    main.postDelayed(autoHide, 1300)
  }

  /** A quick tap on a dock button: remind that it's hold to talk. Never replaces an answer. */
  fun hint(mode: String) {
    if (asking) return
    val dictate = mode != "ask"
    setCompact(
      if (dictate) "Hold to dictate" else "Hold to ask",
      FloColors.forMode(mode),
      Indicator.ICON,
      if (dictate) R.drawable.flo_ic_mic else R.drawable.flo_ic_sparkle,
    )
    main.postDelayed(autoHide, 1500)
  }

  fun askPending(q: String) {
    setCompact("Thinking", FloColors.ASK, Indicator.DOTS)
    if (root == null) return
    asking = true; answer = null
    question.text = q
    setBody("Thinking", FloColors.MUTED)
    actions.visibility = View.GONE
  }

  /** The computer is slow or away: say why, in the card. */
  fun askStatus(text: String) {
    if (!asking || root == null || answer != null) return
    setBody(text, FloColors.MUTED)
    expand()
  }

  fun askAnswer(text: String) {
    if (!asking || root == null) return
    answer = text
    setBody(text, Color.WHITE)
    actions.visibility = View.VISIBLE
    expand()
  }

  fun askError(text: String) {
    if (!asking || root == null) return
    answer = null
    setBody(text, FloColors.WARN)
    actions.visibility = View.GONE
    expand()
  }

  /** Fade and settle away (the window is removed when the fade ends). */
  fun dismiss() {
    val r = detach() ?: return
    val c = capsule
    if (!animationsOn()) { runCatching { wm.removeView(r) }; return }
    c.pivotX = c.width / 2f
    c.pivotY = compactH / 2f
    c.animate().alpha(0f).scaleX(0.92f).scaleY(0.92f).setStartDelay(0).setDuration(FloMotion.DISMISS)
      .setInterpolator(floEase()).withLayer()
      .withEndAction { runCatching { wm.removeView(r) } }.start()
  }

  fun dismissNow() {
    val r = detach() ?: return
    runCatching { wm.removeView(r) }
  }

  /** After a rotation: re-center on the cutout and re-fit. */
  fun relayout() {
    val r = root ?: return
    val p = params ?: return
    morph?.cancel(); morph = null
    geometry()
    p.y = topY
    runCatching { wm.updateViewLayout(r, p) }
    compact.layoutParams = compact.layoutParams.apply { height = compactH }
    if (expanded) expand() else morphTo(compactWidth(shownText), compactH, compactH / 2f)
  }

  private fun detach(): FrameLayout? {
    main.removeCallbacks(autoHide)
    morph?.cancel(); morph = null
    val r = root ?: return null
    root = null; params = null
    expanded = false; asking = false; answer = null
    swapSeq++
    wave.stop()
    return r
  }

  // ── states ─────────────────────────────────────────────────────────────────

  private fun setCompact(text: String, color: Int, indicator: Indicator, icon: Int = 0) {
    val fresh = root == null
    if (!ensure()) return
    main.removeCallbacks(autoHide)
    capsule.contentDescription = text
    val wasExpanded = expanded
    if (expanded) {
      expanded = false
      card.animate().cancel()
      card.animate().alpha(0f).setStartDelay(0).setDuration(FloMotion.FADE_OUT).withLayer()
        .withEndAction { if (!expanded) card.visibility = View.GONE }.start()
      compact.visibility = View.VISIBLE
      compact.animate().cancel()
      compact.animate().alpha(1f).setStartDelay(FloMotion.FADE_OUT).setDuration(FloMotion.FADE_IN).start()
    }
    swapContent(text, "$indicator:$color:$icon", instant = fresh || wasExpanded) {
      when (indicator) {
        Indicator.BARS -> { badge.visibility = View.GONE; wave.visibility = View.VISIBLE; wave.bars(color) }
        Indicator.DOTS -> { badge.visibility = View.GONE; wave.visibility = View.VISIBLE; wave.dots(color) }
        Indicator.ICON -> {
          wave.stop(); wave.visibility = View.GONE
          badge.visibility = View.VISIBLE
          badge.setImageResource(icon)
          badge.imageTintList = ColorStateList.valueOf(color)
        }
      }
    }
    morphTo(compactWidth(text), compactH, compactH / 2f)
  }

  /**
   * Change the label and the indicator with a quick cross-fade (out, swap, in) instead of an
   * instant swap. Nothing changes if both are already showing; a newer swap supersedes an older one.
   */
  private fun swapContent(text: String, key: String, instant: Boolean, apply: () -> Unit) {
    val sameText = text == shownText
    val sameKey = key == shownKey
    shownText = text; shownKey = key
    if (sameText && sameKey) return
    val seq = ++swapSeq
    val parts = listOfNotNull(if (sameText) null else label, if (sameKey) null else slot)
    if (instant || !animationsOn()) {
      label.text = text; apply()
      parts.forEach { it.animate().cancel(); it.alpha = 1f }
      return
    }
    parts.forEachIndexed { i, v ->
      v.animate().cancel()
      v.animate().alpha(0f).setStartDelay(0).setDuration(FloMotion.FADE_OUT).setInterpolator(floEase())
        .withEndAction {
          if (seq != swapSeq) return@withEndAction
          if (i == 0) { label.text = text; apply() }
          v.animate().alpha(1f).setStartDelay(0).setDuration(FloMotion.FADE_IN).setInterpolator(floEase()).start()
        }.start()
    }
  }

  private fun expand() {
    if (root == null) return
    main.removeCallbacks(autoHide)
    val (w, h) = fitCard()
    if (!expanded) {
      expanded = true
      wave.stop()
      shownKey = "" // the indicator is off now: the next compact state must switch it back on
      compact.animate().cancel()
      compact.animate().alpha(0f).setStartDelay(0).setDuration(FloMotion.FADE_OUT)
        .withEndAction { if (expanded) compact.visibility = View.INVISIBLE }.start()
      card.animate().cancel()
      card.visibility = View.VISIBLE
      card.alpha = 0f
      card.animate().alpha(1f).setStartDelay(FloMotion.FADE_OUT).setDuration(FloMotion.FADE_IN + 40).withLayer().start()
    }
    morphTo(w, h, ctx.dp(28).toFloat())
  }

  private fun setBody(text: String, color: Int) {
    body.text = text
    body.setTextColor(color)
  }

  // ── the morph ──────────────────────────────────────────────────────────────

  /**
   * Animate the black shape to [w] x [h] with corner radius [r]: grow the window once (if needed),
   * animate the outline inside it, trim the window when done.
   */
  private fun morphTo(w0: Int, h: Int, r: Float) {
    val r0 = root ?: return
    val w = evenWithScreen(w0)
    morph?.cancel(); morph = null
    if (!animationsOn()) {
      curW = w.toFloat(); curH = h.toFloat(); curR = r
      sizeWindow(r0, w, h)
      applyFrame()
      return
    }
    if (abs(curW - w) < 0.5f && abs(curH - h) < 0.5f && abs(curR - r) < 0.5f) {
      sizeWindow(r0, w, h)
      return
    }
    // the window must hold every frame of the morph: the larger of where we are and where we go
    val p = params ?: return
    val needW = evenWithScreen(max(ceil(curW).toInt(), w))
    val needH = max(ceil(curH).toInt(), h)
    if (p.width < needW || p.height < needH) sizeWindow(r0, max(p.width, needW), max(p.height, needH))

    val fw = curW; val fh = curH; val fr = curR
    var cancelled = false
    morph = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = FloMotion.MORPH
      interpolator = floEase()
      addUpdateListener { a ->
        val t = a.animatedValue as Float
        curW = fw + (w - fw) * t
        curH = fh + (h - fh) * t
        curR = fr + (r - fr) * t
        applyFrame()
      }
      addListener(object : AnimatorListenerAdapter() {
        override fun onAnimationCancel(animation: Animator) { cancelled = true }
        override fun onAnimationEnd(animation: Animator) {
          if (cancelled || root !== r0) return
          morph = null
          curW = w.toFloat(); curH = h.toFloat(); curR = r
          sizeWindow(r0, w, h)
          applyFrame()
        }
      })
      start()
    }
  }

  /** Resize the overlay window (only at the start or end of a morph, never per frame). */
  private fun sizeWindow(r: FrameLayout, w: Int, h: Int) {
    val p = params ?: return
    if (p.width == w && p.height == h) return
    p.width = w; p.height = h
    runCatching { wm.updateViewLayout(r, p) }
  }

  /** Push the current shape to the screen: the outline, and the compact row's halves to its edges. */
  private fun applyFrame() {
    if (root == null) return
    capsule.invalidateOutline()
    val inset = shapeLeft(capsule.width.takeIf { it > 0 } ?: (params?.width ?: 0)).toFloat()
    slot.translationX = inset
    label.translationX = -inset
  }

  /** The shape's left edge inside a capsule [cw] px wide, centered to the pixel. */
  private fun shapeLeft(cw: Int): Int = max(0, (cw - shapeW(cw)) / 2)

  private fun shapeW(cw: Int): Int {
    var wi = curW.roundToInt().coerceAtMost(cw)
    if ((cw - wi) % 2 != 0) wi -= 1
    return max(0, wi)
  }

  private val outline = object : ViewOutlineProvider() {
    override fun getOutline(view: View, o: Outline) {
      val cw = view.width
      val wi = shapeW(cw)
      val hi = curH.roundToInt().coerceAtMost(max(1, view.height))
      val left = (cw - wi) / 2
      o.setRoundRect(left, 0, left + wi, hi, min(curR, min(wi, hi) / 2f))
    }
  }

  /** Same parity as the screen width, so (screen - w) / 2 is exact and the shape never shifts by half a pixel. */
  private fun evenWithScreen(w: Int): Int {
    val sx = screenSize(wm).x
    return if ((sx - w) % 2 != 0) w + 1 else w
  }

  // ── geometry ───────────────────────────────────────────────────────────────

  private fun geometry() {
    val screen = screenSize(wm)
    val cut = topCutout(screen)
    compactH = ctx.dp(34); topY = ctx.dp(8); centerGap = ctx.dp(8)
    if (cut != null) {
      compactH = max(compactH, cut.height() + ctx.dp(12))
      topY = max(0, cut.centerY() - compactH / 2)
      centerGap = min(cut.width() + ctx.dp(20), ctx.dp(160))
    }
  }

  /** A camera cutout at the top center, if the phone has one (Android 10+ reports it). */
  @Suppress("DEPRECATION")
  private fun topCutout(screen: Point): Rect? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
    val rects = runCatching { wm.defaultDisplay.cutout?.boundingRects }.getOrNull() ?: return null
    return rects.firstOrNull {
      it.top <= ctx.dp(8) && it.height() > 0 && it.height() < screen.y / 5 && abs(it.centerX() - screen.x / 2) < screen.x / 6
    }
  }

  /**
   * Content on both sides of the camera, so the hole falls in the empty middle. The label side is
   * at least as wide as "Listening", so Listening, Thinking and Typing share one width and the
   * island doesn't twitch between them.
   */
  private fun compactWidth(text: String): Int {
    val left = ctx.dp(14) + ctx.dp(24)
    val textW = max(label.paint.measureText(text), label.paint.measureText(MIN_LABEL))
    val right = textW.roundToInt() + ctx.dp(16)
    val w = 2 * max(left, right) + centerGap
    return w.coerceIn(ctx.dp(110), screenSize(wm).x - ctx.dp(24))
  }

  /** Measure the card at its final width, capping the answer's scroll so the card stays under 42%. */
  private fun fitCard(): Pair<Int, Int> {
    val screen = screenSize(wm)
    val w = evenWithScreen(min(screen.x - ctx.dp(16), ctx.dp(440)))
    val maxH = (screen.y * 0.42f).roundToInt()
    val exactW = View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY)
    val any = View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
    scroll.layoutParams = scroll.layoutParams.apply { height = LinearLayout.LayoutParams.WRAP_CONTENT }
    card.measure(exactW, any)
    var h = card.measuredHeight
    if (h > maxH) {
      val sh = max(ctx.dp(56), scroll.measuredHeight - (h - maxH))
      scroll.layoutParams = scroll.layoutParams.apply { height = sh }
      card.measure(exactW, any)
      h = card.measuredHeight
    }
    card.layoutParams = FrameLayout.LayoutParams(w, h, Gravity.TOP or Gravity.CENTER_HORIZONTAL)
    return w to h
  }

  // ── views ──────────────────────────────────────────────────────────────────

  private fun ensure(): Boolean {
    if (root != null) return true
    geometry()
    val r = FrameLayout(ctx)
    capsule = FrameLayout(ctx)
    capsule.setBackgroundColor(Color.BLACK)
    capsule.outlineProvider = outline
    capsule.clipToOutline = true
    capsule.setOnClickListener { if (asking && !expanded) expand() }
    // a window resize re-lays the capsule out: put the shape back on the new size before drawing
    capsule.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> applyFrame() }

    compact = buildCompact()
    card = buildCard()
    card.visibility = View.GONE
    capsule.addView(compact, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, compactH, Gravity.TOP))
    capsule.addView(card, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.CENTER_HORIZONTAL))
    r.addView(capsule, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

    // start as a dot over the camera, then grow sideways out of it
    val start = evenWithScreen(compactH)
    curW = start.toFloat(); curH = compactH.toFloat(); curR = compactH / 2f
    shownText = ""; shownKey = ""
    val p = overlayParams(start, compactH).apply {
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      y = topY
    }
    if (runCatching { wm.addView(r, p) }.isFailure) return false
    root = r; params = p
    expanded = false
    if (animationsOn()) {
      capsule.alpha = 0f
      capsule.animate().alpha(1f).setStartDelay(0).setDuration(FloMotion.APPEAR / 2).setInterpolator(floEase()).start()
      compact.alpha = 0f
      compact.animate().alpha(1f).setStartDelay(FloMotion.APPEAR / 3).setDuration(FloMotion.APPEAR).setInterpolator(floEase()).start()
    }
    return true
  }

  private fun buildCompact(): LinearLayout {
    val row = LinearLayout(ctx)
    row.orientation = LinearLayout.HORIZONTAL
    row.gravity = Gravity.CENTER_VERTICAL
    row.setPadding(ctx.dp(14), 0, ctx.dp(16), 0)
    slot = FrameLayout(ctx)
    wave = FloWave(ctx)
    badge = ctx.iconView(R.drawable.flo_ic_check, Color.WHITE, null)
    badge.visibility = View.GONE
    slot.addView(wave, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    slot.addView(badge, FrameLayout.LayoutParams(ctx.dp(18), ctx.dp(18), Gravity.CENTER))
    row.addView(slot, LinearLayout.LayoutParams(ctx.dp(24), ctx.dp(18)))
    row.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f))
    label = TextView(ctx)
    label.textSize = 12.5f
    label.typeface = MEDIUM
    label.setTextColor(Color.WHITE)
    label.maxLines = 1
    row.addView(label, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    return row
  }

  private fun buildCard(): LinearLayout {
    val c = LinearLayout(ctx)
    c.orientation = LinearLayout.VERTICAL
    // the header row lines up with the camera row, title on the left and Close on the right of it
    val headTop = max(ctx.dp(6), (compactH - ctx.dp(36)) / 2)
    c.setPadding(ctx.dp(18), headTop, ctx.dp(8), ctx.dp(16))

    val head = LinearLayout(ctx)
    head.orientation = LinearLayout.HORIZONTAL
    head.gravity = Gravity.CENTER_VERTICAL
    head.addView(ctx.iconView(R.drawable.flo_ic_sparkle, FloColors.ASK, null), LinearLayout.LayoutParams(ctx.dp(16), ctx.dp(16)))
    val title = TextView(ctx)
    title.text = "Ask Flo"
    title.textSize = 13f
    title.typeface = MEDIUM
    title.setTextColor(FloColors.ASK_SOFT)
    head.addView(title, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = ctx.dp(8) })
    val close = ctx.iconView(R.drawable.flo_ic_close, FloColors.MUTED, "Close")
    close.background = ripple(circle(Color.TRANSPARENT))
    close.setPadding(ctx.dp(9), ctx.dp(9), ctx.dp(9), ctx.dp(9))
    close.setOnClickListener { onClose() }
    head.addView(close, LinearLayout.LayoutParams(ctx.dp(36), ctx.dp(36)))
    c.addView(head, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, ctx.dp(36)))

    question = TextView(ctx)
    question.textSize = 13f
    question.setTextColor(FloColors.MUTED)
    question.maxLines = 2
    question.ellipsize = TextUtils.TruncateAt.END
    c.addView(question, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
      topMargin = ctx.dp(2); marginEnd = ctx.dp(10)
    })

    body = TextView(ctx)
    body.textSize = 15.5f
    body.setLineSpacing(0f, 1.15f)
    body.setTextColor(Color.WHITE)
    scroll = ScrollView(ctx)
    scroll.overScrollMode = View.OVER_SCROLL_NEVER
    scroll.addView(body)
    c.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
      topMargin = ctx.dp(10); marginEnd = ctx.dp(10)
    })

    actions = LinearLayout(ctx)
    actions.orientation = LinearLayout.HORIZONTAL
    actions.gravity = Gravity.CENTER_VERTICAL
    actions.visibility = View.GONE

    val insert = LinearLayout(ctx)
    insert.orientation = LinearLayout.HORIZONTAL
    insert.gravity = Gravity.CENTER
    insert.background = ripple(roundRect(Color.WHITE, ctx.dp(20).toFloat()), 0x22000000)
    insert.setPadding(ctx.dp(16), 0, ctx.dp(18), 0)
    insert.contentDescription = "Insert"
    insert.addView(ctx.iconView(R.drawable.flo_ic_insert, FloColors.INK, null), LinearLayout.LayoutParams(ctx.dp(18), ctx.dp(18)))
    val insertText = TextView(ctx)
    insertText.text = "Insert"
    insertText.textSize = 14f
    insertText.typeface = MEDIUM
    insertText.setTextColor(FloColors.INK)
    insertText.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    insert.addView(insertText, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = ctx.dp(6) })
    insert.setOnClickListener { answer?.let { onInsert(it) } }
    actions.addView(insert, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, ctx.dp(40)))

    val copy = FrameLayout(ctx)
    copy.background = ripple(circle(FloColors.CHIP))
    copy.contentDescription = "Copy"
    copy.addView(ctx.iconView(R.drawable.flo_ic_copy, Color.WHITE, null), FrameLayout.LayoutParams(ctx.dp(18), ctx.dp(18), Gravity.CENTER))
    copy.setOnClickListener { answer?.let { onCopy(it) } }
    actions.addView(copy, LinearLayout.LayoutParams(ctx.dp(40), ctx.dp(40)).apply { marginStart = ctx.dp(10) })

    c.addView(actions, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = ctx.dp(14) })
    return c
  }

  private companion object {
    /** The label side is never narrower than this word, so the working states share one width. */
    const val MIN_LABEL = "Listening"
  }
}
