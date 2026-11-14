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
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * The Flo bubble, drawn on one canvas (no child views, no layout passes while it moves), in one of
 * five looks (BubbleConfig.style). src/ui/OrbPreview.tsx is its SVG twin for the live preview in the
 * app: same geometry, colours and states, so keep the two in step (a jest test reads the constants
 * below from this file).
 *
 * - orb: the Flo wave mark on a deep-blue glass orb with a thin live ring.
 * - glass: a see-through dark disc with a gradient rim and a white mark.
 * - pill: a slim upright capsule in your gradient that hugs the edge.
 * - dot: a small gradient dot, nothing else.
 * - mascot: a gradient face with eyes that look up while Flo thinks and a mouth that talks with you.
 *
 * States:
 * - Idle: a calm, still ring. Nothing animates and nothing redraws.
 * - Listening: the ring becomes a waveform that follows your voice (the pill shows three bars, the
 *   mascot opens its mouth). The recognizer reports a level ~10-20 times a second; a vsync frame loop
 *   (postOnAnimation) eases toward it, so it never jumps. Runs only while listening.
 * - Thinking: a soft comet runs around the ring (one linear infinite animator).
 * - Done: a green ring closes and the mark turns into a check (one short animator).
 * - Error: a red ring and a small shake (one short animator).
 * - Offline: a small amber pip on the body, in every state.
 *
 * The body sits centred in the view with [pad] around it for the ring and the shadow. With system
 * animations off every state is drawn still.
 */
internal class FloOrb(ctx: Context) : View(ctx) {
  enum class State { IDLE, LISTENING, THINKING, DONE, ERROR }

  var state = State.IDLE
    private set
  private var style = "orb"
  private var bodyW = ctx.dp(46)
  private var bodyH = ctx.dp(46)
  private var accent = BubbleConfig.DEFAULT_ACCENT
  private var accent2 = BubbleConfig.DEFAULT_ACCENT2
  private var ringColor = accent
  var offline = false
    set(v) {
      if (field != v) { field = v; invalidate() }
    }

  private val body = Paint(Paint.ANTI_ALIAS_FLAG)
  private val tintFill = Paint(Paint.ANTI_ALIAS_FLAG)
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
  private val face = Paint(Paint.ANTI_ALIAS_FLAG)
  private val faceLine = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }

  private val markPath = Path()
  private val checkPath = Path()
  private val checkPart = Path()
  private val checkMeasure = PathMeasure()
  private val outline = Path() // the pill's ring, starting top-left like an SVG <rect>
  private val outlineMeasure = PathMeasure()
  private val outlinePart = Path()
  private val shape = Path()
  private val arc = RectF()
  private val tmp = Path()
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

  private val round: Boolean get() = style != "pill"

  init {
    outlineProvider = object : ViewOutlineProvider() {
      override fun getOutline(view: View, o: Outline) {
        val l = (width - bodyW) / 2
        val t = (height - bodyH) / 2
        if (round) o.setOval(l, t, l + bodyW, t + bodyH)
        else o.setRoundRect(l, t, l + bodyW, t + bodyH, bodyW / 2f)
      }
    }
    elevation = ctx.dp(6).toFloat()
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
  }

  /** Look, body size (px) and colours; rebuilds the gradients once, not per frame. */
  fun configure(look: String, wPx: Int, hPx: Int, accentColor: Int, accent2Color: Int) {
    if (look == style && wPx == bodyW && hPx == bodyH && accentColor == accent && accent2Color == accent2) return
    style = look
    bodyW = wPx
    bodyH = hPx
    accent = accentColor
    accent2 = accent2Color
    if (state == State.IDLE) ringColor = accent
    elevation = context.dp(if (style == "glass") 2 else if (style == "dot") 4 else 6).toFloat()
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

  /** Radius used for the round looks, and the mark's scale for all of them. */
  private val r: Float get() = min(bodyW, bodyH) / 2f

  /** A rounded rect path starting at (left + radius, top), clockwise: the same start as an SVG <rect>. */
  private fun roundRectPath(p: Path, l: Float, t: Float, rr: Float, b: Float, rad: Float) {
    p.reset()
    p.moveTo(l + rad, t)
    p.lineTo(rr - rad, t)
    arc.set(rr - 2 * rad, t, rr, t + 2 * rad); p.arcTo(arc, -90f, 90f)
    p.lineTo(rr, b - rad)
    arc.set(rr - 2 * rad, b - 2 * rad, rr, b); p.arcTo(arc, 0f, 90f)
    p.lineTo(l + rad, b)
    arc.set(l, b - 2 * rad, l + 2 * rad, b); p.arcTo(arc, 90f, 90f)
    p.lineTo(l, t + rad)
    arc.set(l, t, l + 2 * rad, t + 2 * rad); p.arcTo(arc, 180f, 90f)
    p.close()
  }

  private fun rebuild() {
    if (width == 0 || height == 0) return
    val cx = width / 2f
    val cy = height / 2f
    val r = this.r
    val hw = bodyW / 2f
    val hh = bodyH / 2f
    when (style) {
      "glass" -> {
        body.shader = null
        body.color = withAlpha(INK, GLASS_ALPHA)
        tintFill.shader = LinearGradient(cx - hw, cy - hh, cx + hw, cy + hh, withAlpha(accent, 46), withAlpha(accent2, 46), Shader.TileMode.CLAMP)
      }
      "pill" -> body.shader = LinearGradient(0f, cy - hh, 0f, cy + hh, accent, accent2, Shader.TileMode.CLAMP)
      "dot" -> body.shader = RadialGradient(
        cx - r * 0.3f, cy - r * 0.35f, r * 1.3f,
        intArrayOf(mix(accent, Color.WHITE, 0.35f), accent, accent2), floatArrayOf(0f, 0.6f, 1f), Shader.TileMode.CLAMP,
      )
      "mascot" -> body.shader = LinearGradient(cx - hw, cy - hh, cx + hw, cy + hh, accent, accent2, Shader.TileMode.CLAMP)
      else -> body.shader = RadialGradient(
        // deep-blue glass, lit from the top left, with a little of the accent mixed in
        cx - r * 0.35f, cy - r * 0.45f, r * 1.45f,
        intArrayOf(mix(ORB_LIGHT, accent, 0.30f), mix(ORB_MID, accent, 0.12f), ORB_DEEP),
        floatArrayOf(0f, 0.55f, 1f), Shader.TileMode.CLAMP,
      )
    }
    glow.shader = RadialGradient(cx, cy + r * 0.75f, r * 0.95f, intArrayOf(withAlpha(accent2, 150), withAlpha(accent2, 0)), null, Shader.TileMode.CLAMP)
    gloss.shader = LinearGradient(
      0f, cy - hh * 0.92f, 0f, cy - hh * 0.05f,
      Color.argb(110, 255, 255, 255), Color.argb(0, 255, 255, 255), Shader.TileMode.CLAMP,
    )
    rim.strokeWidth = context.dp(if (style == "glass") 1.5f else 1f).toFloat()
    rim.shader = if (style == "glass") LinearGradient(cx - hw, cy - hh, cx + hw, cy + hh, accent, accent2, Shader.TileMode.CLAMP) else null

    // the body's shape
    shape.reset()
    if (round) shape.addCircle(cx, cy, r, Path.Direction.CW)
    else roundRectPath(shape, cx - hw, cy - hh, cx + hw, cy + hh, hw)

    // the Flo wave mark (desktop app icon): M14 37 c5-14 12-14 18-7 s13 7 18-7, dot at (50,23)
    val mr = if (style == "pill") hw * PILL_MARK else r
    val k = (mr * 1.04f) / 44f
    val m = Matrix().apply { setTranslate(-32f, -27.5f); postScale(k, k); postTranslate(cx, cy + mr * 0.04f) }
    markPath.reset()
    markPath.moveTo(14f, 37f)
    markPath.cubicTo(19f, 23f, 26f, 23f, 32f, 30f)
    markPath.cubicTo(38f, 37f, 45f, 37f, 50f, 23f)
    markPath.transform(m)
    mark.strokeWidth = 6.2f * k
    val p0 = floatArrayOf(14f, 37f, 50f, 23f).also { m.mapPoints(it) }
    mark.shader = if (style == "orb") LinearGradient(p0[0], p0[1], p0[2], p0[3], MARK_LIGHT, mix(MARK_LIGHT, accent, 0.55f), Shader.TileMode.CLAMP) else null
    mark.color = MARK_LIGHT
    dotCx = p0[2]; dotCy = p0[3]; dotR = 3.1f * k

    checkPath.reset()
    checkPath.moveTo(cx - r * 0.36f, cy + r * 0.02f)
    checkPath.lineTo(cx - r * 0.1f, cy + r * 0.28f)
    checkPath.lineTo(cx + r * 0.38f, cy - r * 0.26f)
    checkMeasure.setPath(checkPath, false)
    check.strokeWidth = r * 0.16f

    val gap = context.dp(3).toFloat()
    roundRectPath(outline, cx - hw - gap, cy - hh - gap, cx + hw + gap, cy + hh + gap, hw + gap)
    outlineMeasure.setPath(outline, true)

    ring.strokeWidth = context.dp(1.5f).toFloat()
    spike.strokeWidth = context.dp(2).toFloat()
    sweep.strokeWidth = context.dp(2.2f).toFloat()
    pipEdge.strokeWidth = context.dp(1.5f).toFloat()
    faceLine.strokeWidth = r * 0.085f
    sweepShaderFor = 0
  }

  private var dotCx = 0f
  private var dotCy = 0f
  private var dotR = 0f

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (width == 0 || (body.shader == null && style != "glass")) return
    val cx = width / 2f
    val cy = height / 2f
    val r = this.r
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

    // the body
    canvas.drawPath(shape, body)
    when (style) {
      "orb" -> canvas.drawPath(shape, glow)
      "glass" -> canvas.drawPath(shape, tintFill)
    }
    if (state == State.DONE) {
      tint.color = withAlpha(GREEN, (60 * phase).toInt())
      canvas.drawPath(shape, tint)
    }
    if (style != "dot") {
      val hw = bodyW / 2f
      val hh = bodyH / 2f
      arc.set(cx - hw * 0.66f, cy - hh * 0.9f, cx + hw * 0.66f, cy - hh * 0.02f)
      canvas.drawOval(arc, gloss)
    }
    drawRim(canvas, cx, cy, r)

    // what's on it
    when (style) {
      "mascot" -> drawFace(canvas, cx, cy, r)
      "dot" -> {}
      else -> drawMark(canvas, cx, cy, r)
    }
    canvas.restore()

    // the ring
    if (round) drawRoundRing(canvas, cx, cy, r, motion) else drawPillRing(canvas)

    // offline: a small amber pip at the top right of the body
    if (offline) {
      val pr = r * 0.19f
      val px: Float
      val py: Float
      if (round) {
        val a = (-PI / 4).toFloat()
        px = cx + cos(a) * r * 0.80f
        py = cy + sin(a) * r * 0.80f
      } else {
        px = cx + bodyW * 0.32f
        py = cy - bodyH / 2f + bodyW * 0.32f
      }
      canvas.drawCircle(px, py, pr, pip)
      canvas.drawCircle(px, py, pr, pipEdge)
    }
  }

  private fun drawRim(canvas: Canvas, cx: Float, cy: Float, r: Float) {
    val inset = rim.strokeWidth / 2f
    if (round) canvas.drawCircle(cx, cy, r - inset, rim)
    else {
      val hw = bodyW / 2f
      val hh = bodyH / 2f
      roundRectPath(tmp, cx - hw + inset, cy - hh + inset, cx + hw - inset, cy + hh - inset, hw - inset)
      canvas.drawPath(tmp, rim)
    }
  }

  /** The wave mark, the pill's voice bars while listening, or the check it turns into. */
  private fun drawMark(canvas: Canvas, cx: Float, cy: Float, r: Float) {
    if (style == "pill" && state == State.LISTENING) {
      drawBars(canvas, cx, cy)
      return
    }
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
  }

  /** Three bars in the pill that rise with your voice. */
  private fun drawBars(canvas: Canvas, cx: Float, cy: Float) {
    val w = bodyW * 0.12f
    face.color = MARK_LIGHT
    for (i in 0..2) {
      val n = if (animationsOn()) 0.5f + 0.5f * sin(clock * 7.3f + i * 2.1f) else 0.6f
      val h = bodyH * (0.14f + 0.40f * shown * (0.35f + 0.65f * n))
      val x = cx + (i - 1) * bodyW * 0.22f
      arc.set(x - w / 2f, cy - h / 2f, x + w / 2f, cy + h / 2f)
      canvas.drawRoundRect(arc, w / 2f, w / 2f, face)
    }
  }

  /** The mascot: two eyes and a mouth. */
  private fun drawFace(canvas: Canvas, cx: Float, cy: Float, r: Float) {
    val ey = cy - r * 0.08f
    for (side in intArrayOf(-1, 1)) {
      val ex = cx + side * r * 0.30f
      if (state == State.DONE) {
        // happy, closed eyes
        faceLine.color = MARK_LIGHT
        tmp.reset()
        tmp.moveTo(ex - r * 0.15f, ey + r * 0.04f)
        tmp.quadTo(ex, ey - r * 0.16f, ex + r * 0.15f, ey + r * 0.04f)
        canvas.drawPath(tmp, faceLine)
        continue
      }
      face.color = MARK_LIGHT
      arc.set(ex - r * 0.15f, ey - r * 0.20f, ex + r * 0.15f, ey + r * 0.20f)
      canvas.drawOval(arc, face)
      face.color = INK
      val lookX = if (state == State.THINKING) r * 0.05f else r * 0.02f
      val lookY = if (state == State.THINKING) -r * 0.07f else r * 0.03f
      canvas.drawCircle(ex + lookX, ey + lookY, r * 0.085f, face)
    }
    if (state == State.LISTENING) {
      face.color = INK
      val ry = r * (0.06f + 0.12f * shown)
      arc.set(cx - r * 0.12f, cy + r * 0.34f - ry, cx + r * 0.12f, cy + r * 0.34f + ry)
      canvas.drawOval(arc, face)
    } else {
      faceLine.color = INK
      tmp.reset()
      tmp.moveTo(cx - r * 0.22f, cy + r * 0.28f)
      tmp.quadTo(cx, cy + r * 0.46f, cx + r * 0.22f, cy + r * 0.28f)
      canvas.drawPath(tmp, faceLine)
    }
  }

  private fun drawRoundRing(canvas: Canvas, cx: Float, cy: Float, r: Float, motion: Boolean) {
    val ringR = r + context.dp(3)
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
  }

  /** The pill's ring follows its outline: a glow while listening, a comet while thinking. */
  private fun drawPillRing(canvas: Canvas) {
    val len = outlineMeasure.length
    when (state) {
      State.IDLE -> {
        ring.color = withAlpha(ringColor, 150)
        canvas.drawPath(outline, ring)
      }
      State.LISTENING -> {
        val w = ring.strokeWidth
        ring.strokeWidth = w + context.dp(2.5f) * shown
        ring.color = withAlpha(ringColor, (120 + 135 * shown).toInt())
        canvas.drawPath(outline, ring)
        ring.strokeWidth = w
      }
      State.THINKING -> {
        ring.color = withAlpha(ringColor, 48)
        canvas.drawPath(outline, ring)
        val start = phase * len
        val seg = len * 0.35f
        outlinePart.reset()
        outlineMeasure.getSegment(start, min(len, start + seg), outlinePart, true)
        if (start + seg > len) outlineMeasure.getSegment(0f, start + seg - len, outlinePart, true)
        sweep.shader = null
        sweep.color = ringColor
        sweepShaderFor = 0
        canvas.drawPath(outlinePart, sweep)
      }
      State.DONE -> {
        ring.color = GREEN
        outlinePart.reset()
        outlineMeasure.getSegment(0f, len * min(1f, phase * 1.4f), outlinePart, true)
        canvas.drawPath(outlinePart, ring)
      }
      State.ERROR -> {
        ring.color = withAlpha(RED, (255 * (0.55f + 0.45f * (1f - phase))).toInt())
        canvas.drawPath(outline, ring)
      }
    }
  }

  /** A ring of short spikes around the body that rise with your voice and ripple gently. */
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
    /** the glass look's dark fill, out of 255 */
    const val GLASS_ALPHA = 107
    /** the pill's width × this = the mark's radius */
    const val PILL_MARK = 1.25f
    /** body sizes for the looks that aren't round at the full diameter (bubbleSettings.ts bodySize) */
    const val PILL_W = 0.68f
    const val PILL_H = 1.32f
    const val DOT_K = 0.56f

    val ORB_LIGHT: Int = Color.parseColor("#3D5BD9")
    val ORB_MID: Int = Color.parseColor("#16237A")
    val ORB_DEEP: Int = Color.parseColor("#070C2C")
    val MARK_LIGHT: Int = Color.parseColor("#E9F7FF")
    val GREEN: Int = Color.parseColor("#34D399")
    val RED: Int = Color.parseColor("#F87171")
    val WARN: Int = Color.parseColor("#FBBF24")
    val INK: Int = Color.parseColor("#0B1220")

    /** Body width and height in px for [style] at diameter [d] px (bubbleSettings.ts bodySize, in dp). */
    fun bodySize(ctx: Context, style: String, sizeDp: Int): Pair<Int, Int> = when (style) {
      "pill" -> ctx.dp((sizeDp * PILL_W).roundToInt()) to ctx.dp((sizeDp * PILL_H).roundToInt())
      "dot" -> ctx.dp((sizeDp * DOT_K).roundToInt()).let { it to it }
      else -> ctx.dp(sizeDp).let { it to it }
    }

    fun smoothToward(cur: Float, target: Float, dt: Float, tau: Float): Float = cur + (target - cur) * (1f - exp(-dt / tau))

    fun withAlpha(c: Int, a: Int): Int = Color.argb(a.coerceIn(0, 255), Color.red(c), Color.green(c), Color.blue(c))

    fun mix(a: Int, b: Int, t: Float): Int = Color.rgb(
      (Color.red(a) + (Color.red(b) - Color.red(a)) * t).toInt(),
      (Color.green(a) + (Color.green(b) - Color.green(a)) * t).toInt(),
      (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * t).toInt(),
    )
  }
}
