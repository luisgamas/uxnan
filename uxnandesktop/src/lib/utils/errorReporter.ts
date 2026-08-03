/**
 * Forward uncaught frontend failures into the app's own log (`diagnostics.rs`).
 *
 * The failure this exists for: the window goes blank (or black) while the
 * process stays perfectly healthy. Nothing on the machine records that — there
 * is no OS crash report, because nothing crashed, and no WebView2 minidump,
 * because the renderer never died. The evidence only exists inside the webview,
 * as an uncaught exception or a rejected promise, and it disappears with the
 * window. So both are captured here and written to the same file the Rust side
 * logs to, giving one timeline across backend and frontend.
 *
 * Reporting is best-effort and deliberately quiet: a failure to report must
 * never become a second failure (the invoke is fire-and-forget, and its own
 * rejection is swallowed), and the console still receives the browser's normal
 * output because the handlers are passive listeners — nothing is prevented,
 * defaulted, or swallowed from the page's point of view.
 */

import { diagnosticsLog } from "$lib/api";

/** Longest message we forward; the Rust side bounds it again. Cutting here
 *  keeps a runaway stack from crossing the IPC boundary in the first place. */
const MAX_MESSAGE = 4000;

/** Render an arbitrary thrown value as one readable line.
 *
 *  `throw` accepts anything, so this has to survive a non-Error: a string, a
 *  DOM event, `undefined`, or an object with no message. An `Error` keeps its
 *  name, message and stack (the stack is what makes a blank-screen report
 *  actionable); anything else is described as faithfully as it can be. */
export function describeError(value: unknown): string {
  if (value instanceof Error) {
    const stack = value.stack?.trim();
    // A stack usually already starts with "Name: message"; avoid repeating it.
    if (stack && stack.startsWith(value.name)) return stack.slice(0, MAX_MESSAGE);
    return `${value.name}: ${value.message}${stack ? `\n${stack}` : ""}`.slice(
      0,
      MAX_MESSAGE,
    );
  }
  if (typeof value === "string") return value.slice(0, MAX_MESSAGE) || "(empty)";
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  try {
    return JSON.stringify(value)?.slice(0, MAX_MESSAGE) ?? String(value);
  } catch {
    // Circular structures, getters that throw, exotic proxies.
    return Object.prototype.toString.call(value);
  }
}

/** Compose the line for an `error` event, keeping the source location when the
 *  browser gave us one (a bundled build reports `chunk.js:1:12345`, which is
 *  still the fastest way to a culprit alongside the stack). */
export function formatErrorEvent(event: {
  message?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  error?: unknown;
}): string {
  const described = event.error
    ? describeError(event.error)
    : (event.message ?? "uncaught error");
  const where =
    event.filename && event.filename.length > 0
      ? ` (${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0})`
      : "";
  return `${described}${where}`;
}

/**
 * Install the two listeners. Returns an uninstaller.
 *
 * `report` is injectable so tests can drive it without a Tauri host; it
 * defaults to the real command wrapper.
 */
export function installErrorReporter(
  win: Window = window,
  report: (
    level: string,
    source: string,
    message: string,
  ) => Promise<void> | void = diagnosticsLog,
): () => void {
  const send = (source: string, message: string): void => {
    try {
      void Promise.resolve(report("error", source, message)).catch(() => {
        /* reporting must never raise a second failure */
      });
    } catch {
      /* the host may be gone entirely (window closing) */
    }
  };

  const onError = (event: ErrorEvent): void => {
    send("webview.error", formatErrorEvent(event));
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    send("webview.rejection", describeError(event.reason));
  };

  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);
  return () => {
    win.removeEventListener("error", onError);
    win.removeEventListener("unhandledrejection", onRejection);
  };
}
