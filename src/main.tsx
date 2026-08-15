import React, { Component, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { I18nProvider } from "./ui/I18nContext";
import { initLocale, t } from "./core/i18n";
import { useApp } from "./app/stores";
import "./styles.css";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error): void {
    pushLog(`render error: ${error.message}`);
  }

  render() {
    if (this.state.error) {
      initLocale();
      return (
        <div className="splash">
          <h2>{t("common").errorTitle}</h2>
          <p>{this.state.error.message}</p>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            {t("common").reload}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function pushLog(message: string): void {
  try {
    useApp.getState().pushLog(message);
  } catch {
    /* store ещё не инициализирован — игнорируем */
  }
  invoke("log_frontend", { message }).catch(() => {});
}

window.addEventListener("error", (e) => {
  pushLog(`error: ${e.message}`);
});
window.addEventListener("unhandledrejection", (e) => {
  pushLog(
    `unhandledrejection: ${String((e.reason as Error | undefined)?.message ?? e.reason)}`,
  );
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
