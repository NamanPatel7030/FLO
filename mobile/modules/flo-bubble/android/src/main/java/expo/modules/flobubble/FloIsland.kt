package expo.modules.flobubble

import android.animation.ValueAnimator
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Point
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.math.abs
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
 */
internal class FloIsland(private val ctx: Context, private val wm: WindowManager) {
  var onClose: () -> Unit = {}
  var onInsert: (String) -> Unit = {}
  var onCopy: (String) -> Unit = {}

  private enum class Indicator { BARS, DOT, ICON }

  private val main = Handler(Looper.getMainLooper())
  private val autoHide = Runnable { dismiss() }

  private var root: FrameLayout? = null
  private var params: WindowManager.LayoutParams? = null
  private lateinit var capsule: FrameLayout
  private lateinit var shape: GradientDrawable
  private lateinit var compact: LinearLayout
  private lateinit var wave: FloWave
  private lateinit var badge: ImageView
  private lateinit var label: TextView
  private lateinit var card: LinearLayout
  private lateinit var question: TextView
  private lateinit var body: TextView
  private lateinit var scroll: ScrollView
  private lateinit var actions: LinearLayout

  private var morph: ValueAnimator? = null
  private var radius = 0f
  private var compactH = 0
  private var topY = 0
  private var centerGap = 0
  private var expanded = false
  private var asking = false // an Ask is pending or answered: the card belongs to it
  private var answer: String? = null

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
    setCompact(if (mode == "ask") "Thinking" else "Typing", FloColors.forMode(mode), Indicator.DOT)
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
    setCompact("Thinking", FloColors.ASK, Indicator.DOT)
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

  fun dismiss() {
    main.removeCallbacks(autoHide)
    morph?.cancel(); morph = null
    val r = root ?: return
    root = null; params = null
    expanded = false; asking = false; answer = null
    wave.stop()
    capsule.animate().alpha(0f).scaleX(0.85f).scaleY(0.85f).setStartDelay(0).setDuration(160)
      .withEndAction { runCatching { wm.removeView(r) } }.start()
  }

  fun dismissNow() {
    main.removeCallbacks(autoHide)
    morph?.cancel(); morph = null
    val r = root ?: return
    root = null; params = null
    expanded = false; asking = false; answer = null
    wave.stop()
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
    if (expanded) expand() else morphTo(compactWidth(label.text.toString()), compactH, compactH / 2f)
  }

  // ── states ─────────────────────────────────────────────────────────────────

  private fun setCompact(text: String, color: Int, indicator: Indicator, icon: Int = 0) {
    if (!ensure()) return
    main.removeCallbacks(autoHide)
    label.text = text
    capsule.contentDescription = text
    when (indicator) {
      Indicator.BARS -> { badge.visibility = View.GONE; wave.visibility = View.VISIBLE; wave.bars(color) }
      Indicator.DOT -> { badge.visibility = View.GONE; wave.visibility = View.VISIBLE; wave.pulse(color) }
      Indicator.ICON -> {
        wave.stop(); wave.visibility = View.GONE
        badge.visibility = View.VISIBLE
        badge.setImageResource(icon)
        badge.imageTintList = ColorStateList.valueOf(color)
      }
    }
    if (expanded) {
      expanded = false
      card.animate().alpha(0f).setStartDelay(0).setDuration(90).withEndAction { if (!expanded) card.visibility = View.GONE }.start()
      compact.visibility = View.VISIBLE
      compact.animate().alpha(1f).setStartDelay(90).setDuration(140).start()
    }
    morphTo(compactWidth(text), compactH, compactH / 2f)
  }

  private fun expand() {
    if (root == null) return
    main.removeCallbacks(autoHide)
    val (w, h) = fitCard()
    if (!expanded) {
      expanded = true
      wave.stop()
      compact.animate().alpha(0f).setStartDelay(0).setDuration(90).withEndAction { if (expanded) compact.visibility = View.INVISIBLE }.start()
      card.visibility = View.VISIBLE
      card.alpha = 0f
      card.animate().alpha(1f).setStartDelay(80).setDuration(160).start()
    }
    morphTo(w, h, ctx.dp(28).toFloat())
  }

  private fun setBody(text: String, color: Int) {
    body.text = text
    body.setTextColor(color)
  }

  /** Animate the capsule's size and corner radius (the island "morph"). */
  private fun morphTo(w: Int, h: Int, r: Float) {
    val lp = capsule.layoutParams
    val w0 = lp.width
    val h0 = lp.height
    val r0 = radius
    morph?.cancel()
    morph = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 220
      interpolator = DecelerateInterpolator(1.6f)
      addUpdateListener { a ->
        val t = a.animatedValue as Float
        lp.width = (w0 + (w - w0) * t).roundToInt()
        lp.height = (h0 + (h - h0) * t).roundToInt()
        radius = r0 + (r - r0) * t
        shape.cornerRadius = radius
        capsule.layoutParams = lp
        capsule.invalidateOutline()
      }
      start()
    }
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

  /** Content on both sides of the camera, so the hole falls in the empty middle. */
  private fun compactWidth(text: String): Int {
    val left = ctx.dp(14) + ctx.dp(24)
    val right = label.paint.measureText(text).roundToInt() + ctx.dp(16)
    val w = 2 * max(left, right) + centerGap
    return w.coerceIn(ctx.dp(110), screenSize(wm).x - ctx.dp(24))
  }

  /** Measure the card at its final width, capping the answer's scroll so the card stays under 42%. */
  private fun fitCard(): Pair<Int, Int> {
    val screen = screenSize(wm)
    val w = min(screen.x - ctx.dp(16), ctx.dp(440))
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
    radius = compactH / 2f
    shape = roundRect(Color.BLACK, radius)
    capsule = FrameLayout(ctx)
    capsule.background = shape
    capsule.clipToOutline = true
    capsule.setOnClickListener { if (asking && !expanded) expand() }

    compact = buildCompact()
    card = buildCard()
    card.visibility = View.GONE
    capsule.addView(compact, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, compactH, Gravity.TOP))
    capsule.addView(card, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.CENTER_HORIZONTAL))
    r.addView(capsule, FrameLayout.LayoutParams(ctx.dp(110), compactH))

    val p = overlayParams(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT).apply {
      gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
      y = topY
    }
    if (runCatching { wm.addView(r, p) }.isFailure) return false
    root = r; params = p
    expanded = false
    capsule.alpha = 0f; capsule.scaleX = 0.7f; capsule.scaleY = 0.7f
    capsule.animate().alpha(1f).scaleX(1f).scaleY(1f).setStartDelay(0).setDuration(200).setInterpolator(DecelerateInterpolator()).start()
    return true
  }

  private fun buildCompact(): LinearLayout {
    val row = LinearLayout(ctx)
    row.orientation = LinearLayout.HORIZONTAL
    row.gravity = Gravity.CENTER_VERTICAL
    row.setPadding(ctx.dp(14), 0, ctx.dp(16), 0)
    val slot = FrameLayout(ctx)
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
}
