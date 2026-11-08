/* Site theme: "system" (default, follows prefers-color-scheme), "light" or "dark".
   The resolved theme lives on <html data-theme> and is set by THEME_SCRIPT before first paint. */

export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_KEY = "flo-theme";
export const THEME_EVENT = "flo-theme";

/**
 * Inline <head> script: resolves the stored preference before paint (no flash of the wrong theme)
 * and keeps following the OS while the preference is "system".
 */
export const THEME_SCRIPT = `(function(){var d=document.documentElement,m;try{m=window.matchMedia("(prefers-color-scheme: dark)")}catch(e){}
function pref(){var p;try{p=localStorage.getItem("${THEME_KEY}")}catch(e){}return p==="light"||p==="dark"?p:"system"}
function apply(){var p=pref(),t=p==="system"?(m&&m.matches?"dark":"light"):p;d.dataset.theme=t;d.dataset.themePref=p;d.style.colorScheme=t}
apply();if(m){var f=function(){if(pref()==="system")apply()};m.addEventListener?m.addEventListener("change",f):m.addListener&&m.addListener(f)}})();`;

export function readPref(): ThemePref {
  if (typeof document === "undefined") return "system";
  const p = document.documentElement.dataset.themePref;
  return p === "light" || p === "dark" ? p : "system";
}

function resolve(p: ThemePref): Theme {
  if (p !== "system") return p;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "dark";
  }
}

/** Store the preference, apply it (cross-fading when allowed) and tell listeners. */
export function setThemePref(p: ThemePref) {
  try {
    if (p === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, p);
  } catch {
    /* private mode: still switch for this page */
  }
  const d = document.documentElement;
  const t = resolve(p);
  const apply = () => {
    d.dataset.theme = t;
    d.dataset.themePref = p;
    d.style.colorScheme = t;
  };
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (d.dataset.theme !== t && !reduce && typeof doc.startViewTransition === "function") doc.startViewTransition(apply);
  else apply();
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: p }));
}
