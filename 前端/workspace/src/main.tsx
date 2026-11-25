import { createRoot } from "react-dom/client";
import "./setup";
import { openWorkspace } from "./lib/api";
import { bootstrapGeneratedSiteAnalytics } from "./analytics.ts";
import App from "./App.tsx";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorFallback } from "./components/error-boundary/error-fallback";
import { reportCaughtError } from "./lib/report-caught-error";
import "./index.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container #root was not found.");
}

bootstrapGeneratedSiteAnalytics();

const root = createRoot(container, { onCaughtError: reportCaughtError });
void openWorkspace().catch(() => { /* The bundled demo also works offline. */ }).then(() => root.render(
  <ErrorBoundary FallbackComponent={ErrorFallback}>
    <App />
  </ErrorBoundary>,
));
