import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { isTauri } from "./lib/api";
import { applyPlatformClass, os } from "./lib/os";

// Separate chunks: the always-on island window must stay tiny (no recharts etc.).
const Island = lazy(() => import("./island/Island"));
const Dashboard = lazy(() => import("./dashboard/Dashboard"));
const PermGuide = lazy(() => import("./permguide/PermGuide"));

const isIsland = location.hash.startsWith("#/island");
// the floating "flip this switch" helper shown over System Settings during setup
const isGuide = location.hash.startsWith("#/perm-guide");
if (isIsland) document.documentElement.classList.add("island");
if (isGuide) document.documentElement.classList.add("perm-guide");
if (isTauri) document.documentElement.classList.add("tauri");
applyPlatformClass(os());
// Pause CSS animations while the window is hidden (lightweight when Flo sits in the background).
const syncVisibility = () => document.documentElement.classList.toggle("hidden-doc", document.hidden);
document.addEventListener("visibilitychange", syncVisibility);
syncVisibility();
// Windows / Linux: the dashboard also rests while another app is in front. Behind other windows it
// still counts as visible, and every frame of a decorative loop there is painted by Flo's own
// process (the island never takes focus, so it's left out).
if (!isIsland) {
  const syncFocus = () => document.documentElement.classList.toggle("unfocused", !document.hasFocus());
  window.addEventListener("focus", syncFocus);
  window.addEventListener("blur", syncFocus);
  syncFocus();
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Suspense fallback={null}>{isIsland ? <Island /> : isGuide ? <PermGuide /> : <Dashboard />}</Suspense>
  </React.StrictMode>,
);
