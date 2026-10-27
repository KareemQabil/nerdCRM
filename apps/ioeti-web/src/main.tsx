import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { FeedbackCenter } from "./FeedbackCenter";
import { UiErrorBoundary } from "./UiErrorBoundary";
import { PreferencesProvider } from "./preferences";
import "./styles.css";
import "./x1c.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
  <React.StrictMode>
    <PreferencesProvider>
      <UiErrorBoundary><App /></UiErrorBoundary>
      <FeedbackCenter />
    </PreferencesProvider>
  </React.StrictMode>,
);
