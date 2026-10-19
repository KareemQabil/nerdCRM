import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PreferencesProvider } from "./preferences";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
  <React.StrictMode>
    <PreferencesProvider>
      <App />
    </PreferencesProvider>
  </React.StrictMode>,
);
