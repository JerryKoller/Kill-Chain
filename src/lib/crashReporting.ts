import { useSettingsStore } from "@/state/settingsStore";

/**
 * Opt-in renderer error capture (v1.5). When Settings → "Crash reporting"
 * is ON, uncaught errors and unhandled promise rejections are appended to
 * the local crash.log (via the main process). Nothing leaves the machine
 * unless SENTRY_DSN below is filled in at build time — in that case the
 * same hooks would forward to Sentry.
 */

/** Fill in to enable remote reporting; empty = local log only. */
export const SENTRY_DSN = "";

let installed = false;
let dedupe = new Set<string>();

function report(source: string, message: string): void {
  if (!useSettingsStore.getState().crashReports) return;
  // The same error can fire once per frame (e.g. inside a rAF loop) —
  // log each distinct message once per session.
  const sig = `${source}:${message.slice(0, 200)}`;
  if (dedupe.has(sig)) return;
  if (dedupe.size > 200) dedupe = new Set();
  dedupe.add(sig);
  window.playground?.crash?.log(source, message);
  if (SENTRY_DSN) {
    // Placeholder: initialize @sentry/electron here when a DSN is configured.
  }
}

export function initCrashReporting(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (e) => {
    report(
      "onerror",
      `${e.message} @ ${e.filename ?? "?"}:${e.lineno ?? 0}\n${e.error?.stack ?? ""}`,
    );
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    report(
      "unhandledrejection",
      r instanceof Error ? `${r.message}\n${r.stack ?? ""}` : String(r),
    );
  });
}
