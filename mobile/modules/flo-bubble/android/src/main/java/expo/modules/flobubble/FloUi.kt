package expo.modules.flobubble

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Point
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.util.TypedValue
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import kotlin.math.roundToInt

/** Small shared helpers for the bubble's overlay windows (the thumb dock and the top island). */
internal object FloColors {
  val DICTATE: Int = Color.parseColor("#2F8CFF")
  val ASK: Int = Color.parseColor("#7A6CFF")
  val ASK_SOFT: Int = Color.parseColor("#B9B3FF")
  val DOCK: Int = Color.parseColor("#E60B1220")
  val INK: Int = Color.parseColor("#0B1220")
  val MUTED: Int = Color.parseColor("#9AA3B5")
  val SOFT: Int = Color.parseColor("#C9D3E6")
  val GRIP: Int = Color.parseColor("#6B7590")
  val CHIP: Int = Color.parseColor("#1E2533")
  val WARN: Int = Color.parseColor("#FBBF24")

  fun forMode(mode: String): Int = if (mode == "ask") ASK else DICTATE
}

internal val MEDIUM: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)

internal fun Context.dp(v: Float): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).roundToInt()

internal fun Context.dp(v: Int): Int = dp(v.toFloat())

internal fun roundRect(color: Int, radius: Float): GradientDrawable = GradientDrawable().apply {
  setColor(color)
  cornerRadius = radius
}

internal fun circle(color: Int): GradientDrawable = GradientDrawable().apply {
  shape = GradientDrawable.OVAL
  setColor(color)
}

/** A touch ripple over [content], so tappable bits give feedback. */
internal fun ripple(content: Drawable, rippleColor: Int = 0x33FFFFFF): RippleDrawable =
  RippleDrawable(ColorStateList.valueOf(rippleColor), content, null)

/** A vector icon from res/drawable, tinted. Pass [desc] only when the icon is itself a control. */
internal fun Context.iconView(res: Int, tint: Int, desc: String?): ImageView = ImageView(this).apply {
  setImageResource(res)
  imageTintList = ColorStateList.valueOf(tint)
  scaleType = ImageView.ScaleType.FIT_CENTER
  if (desc != null) contentDescription = desc else importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
}

/**
 * An accessibility overlay window that never takes focus, so the keyboard and the text field stay as
 * they are. Positions are in screen pixels (we lay out over the status bar and camera cutout).
 */
internal fun overlayParams(w: Int, h: Int): WindowManager.LayoutParams = WindowManager.LayoutParams(
  w, h,
  WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
  WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
  PixelFormat.TRANSLUCENT,
).apply {
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
    fitInsetsTypes = 0
    layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
  } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
    layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
  }
}

/** The full screen size in pixels, for the current rotation. */
@Suppress("DEPRECATION")
internal fun screenSize(wm: WindowManager): Point {
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
    val b = wm.maximumWindowMetrics.bounds
    return Point(b.width(), b.height())
  }
  val p = Point()
  wm.defaultDisplay.getRealSize(p)
  return p
}
