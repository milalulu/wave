import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { I18nProvider } from "./ui/I18nContext";
import "./styles.css";

window.addEventListener("error", (e) => {
  invoke("log_frontend", { message: `error: ${e.message}` }).catch(() => {});
});
window.addEventListener("unhandledrejection", (e) => {
  invoke("log_frontend", {
    message: `unhandledrejection: ${String((e.reason as Error | undefined)?.message ?? e.reason)}`,
  }).catch(() => {});
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
