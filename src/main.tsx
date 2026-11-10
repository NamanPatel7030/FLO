import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { isTauri } from "./lib/api";

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
// Pause CSS animations while the window is hidden (lightweight when Flo sits in the background).
const syncVisibility = () => document.documentElement.classList.toggle("hidden-doc", document.hidden);
document.addEventListener("visibilitychange", syncVisibility);
syncVisibility();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Suspense fallback={null}>{isIsland ? <Island /> : isGuide ? <PermGuide /> : <Dashboard />}</Suspense>
  </React.StrictMode>,
);
