import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { isTauri } from "./lib/api";

// Separate chunks: the always-on island window must stay tiny (no recharts etc.).
const Island = lazy(() => import("./island/Island"));
const Dashboard = lazy(() => import("./dashboard/Dashboard"));

const isIsland = location.hash.startsWith("#/island");
if (isIsland) document.documentElement.classList.add("island");
if (isTauri) document.documentElement.classList.add("tauri");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Suspense fallback={null}>{isIsland ? <Island /> : <Dashboard />}</Suspense>
  </React.StrictMode>,
);
