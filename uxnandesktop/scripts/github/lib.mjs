/**
 * Shared plumbing for the GitHub validation tooling: the sandbox harness
 * (`sandbox.mjs`) and the read-only fixture capture (`capture-fixtures.mjs`).
 *
 * Everything here is pure or side-effect-free enough to unit test, because this
 * is the code that stands between a script and somebody's real repository. The
 * two properties that matter:
 *
 * - **The allowlist is exact.** A mutation may only ever target the one sandbox
 *   repository, named twice: once as a constant in this file and once by the
 *   operator through `UXNAN_GH_SANDBOX`. Both must agree, character for
 *   character. There is no default, no prefix match, no "close enough" — a
 *   missing or different value refuses with an explanation, and the production
 *   repository is refused **by name** even if someone edits the constant.
 * - **Nothing secret is ever written.** Logs and captured fixtures pass through
 *   the scrubbers below. `gh` owns the token (OS keyring) and none of these
 *   scripts ever asks for it, but a scrubber that assumes that is a scrubber
 *   that eventually commits a credential.
 */

import { execFileSync } from "node:child_process";

/**
 * The one repository mutations are allowed to touch. Disposable by
 * construction: it holds only generated fixture data and can be deleted whole.
 */
export const SANDBOX_REPO = "luisgamas/uxnan-gh-sandbox";

/**
 * Repositories that must never be mutated by this tooling, refused by name
 * *in addition to* the exact-allowlist check. `luisgamas/uxnan` is the
 * production monorepo this code lives in; listing it here means that even a
 * bad edit to `SANDBOX_REPO` cannot quietly point the harness at it.
 */
export const FORBIDDEN_REPOS = ["luisgamas/uxnan"];

/** The topic the sandbox repo is created with, and that every later mutating
 *  run re-checks before touching anything (the second lock on the door: the
 *  name must match *and* the repo must self-identify as the sandbox). */
export const SANDBOX_TOPIC = "uxnan-gh-sandbox";

/**
 * Resolve and validate the sandbox target from the environment.
 *
 * Returns `{ owner, repo, nameWithOwner }` only when `UXNAN_GH_SANDBOX` is set
 * and equals {@link SANDBOX_REPO} exactly. Throws with an actionable message in
 * every other case. Deliberately strict: trimming is the only normalization —
 * case differences, extra path segments or a URL form are all refusals, because
 * each is a sign the operator is not pointing where they think they are.
 */
export function requireSandbox(env = process.env) {
  const raw = env.UXNAN_GH_SANDBOX;
  if (raw === undefined || String(raw).trim() === "") {
    throw new Error(
      "UXNAN_GH_SANDBOX is not set. This tool mutates a GitHub repository and " +
        `refuses to guess which one. Set UXNAN_GH_SANDBOX=${SANDBOX_REPO} ` +
        "(the only accepted value) to arm it.",
    );
  }
  const value = String(raw).trim();
  if (FORBIDDEN_REPOS.includes(value)) {
    throw new Error(
      `UXNAN_GH_SANDBOX points at ${value}, which is a production repository. ` +
        "This harness will never mutate it. Use the disposable sandbox " +
        `(${SANDBOX_REPO}) instead.`,
    );
  }
  if (value !== SANDBOX_REPO) {
    throw new Error(
      `UXNAN_GH_SANDBOX is "${value}", but the only allowlisted sandbox is ` +
        `"${SANDBOX_REPO}". Refusing: an unexpected value here usually means ` +
        "the environment came from somewhere else, and mutations must never " +
        "follow a value nobody meant.",
    );
  }
  const [owner, repo] = value.split("/");
  return { owner, repo, nameWithOwner: value };
}

/** Token-shaped strings, and flag values that may carry user text, never reach
 *  a log or a fixture. Mirrors `tests/fixtures/fake-gh.mjs`'s scrubber. */
export function scrubSecrets(text) {
  return String(text)
    .replace(/gh[pousr]_[A-Za-z0-9]{16,}/g, "<token>")
    .replace(/github_pat_[A-Za-z0-9_]{22,}/g, "<token>")
    .replace(/(--?(?:token|password|secret)[= ])\S+/gi, "$1<redacted>")
    .replace(/Bearer\s+\S+/gi, "Bearer <redacted>")
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1<credentials>@");
}

/**
 * Keys stripped from captured API payloads before they become fixtures. All of
 * them are public on a public repository, but none is read by any parser under
 * test, so keeping them would only make the fixtures bigger and the diff of a
 * re-capture noisier.
 */
const STRIPPED_KEYS = new Set(["node_id", "gravatar_id"]);

/** RFC-ish email matcher for sanitizing captured payloads. */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Sanitize a captured `gh` payload for freezing as a fixture: strip
 * {@link STRIPPED_KEYS}, and redact anything email-shaped (git commit authors
 * leak real addresses through the timeline API). Shape is otherwise preserved
 * — the whole value of a captured fixture is that the parser sees exactly what
 * GitHub sent.
 */
export function sanitizeCapture(value) {
  if (typeof value === "string") {
    return scrubSecrets(value.replace(EMAIL_RE, "redacted@example.invalid"));
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeCapture);
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (STRIPPED_KEYS.has(k)) continue;
      // GraphQL node ids also arrive as a string-valued `id` (numeric REST ids
      // stay — a parser may legitimately read those).
      if (k === "id" && typeof v === "string") continue;
      out[k] = sanitizeCapture(v);
    }
    return out;
  }
  return value;
}

/** Flags whose *value* is user-authored text (a PR body, an issue title) and is
 *  therefore redacted from any log line. */
const PRIVATE_VALUE_FLAGS = new Set([
  "--body",
  "-b",
  "--title",
  "-t",
  "--field",
  "-f",
  "-F",
  "--raw-field",
]);

/** Render an argv for a log line: private values redacted, secrets scrubbed. */
export function redactArgvForLog(argv) {
  const out = [];
  let redactNext = false;
  for (const arg of argv) {
    if (redactNext) {
      out.push("<redacted>");
      redactNext = false;
      continue;
    }
    if (PRIVATE_VALUE_FLAGS.has(arg)) {
      out.push(arg);
      redactNext = true;
      continue;
    }
    const eq = arg.match(/^(--?[A-Za-z-]+)=(.*)$/);
    if (eq && PRIVATE_VALUE_FLAGS.has(eq[1])) {
      out.push(`${eq[1]}=<redacted>`);
      continue;
    }
    out.push(scrubSecrets(arg));
  }
  return out;
}

/**
 * Whether a `gh` argv is a **read**. Used as a belt-and-braces assertion by the
 * capture script (which must never mutate anything) and by the sandbox
 * harness's dry-run printer (to label each step honestly).
 *
 * The rule is conservative: `gh api` counts as a read only with no explicit
 * method or `--method GET`/`-X GET` (gh defaults to GET, and to POST when
 * `-f/-F` fields are present — so fields make it a mutation); every non-`api`
 * subcommand must be in the explicit read list.
 */
export function isReadInvocation(argv) {
  if (argv.includes("--version")) return true;
  const positional = argv.filter((a) => !a.startsWith("-"));
  const [first, second] = positional;
  if (first === "api") {
    const idx = argv.findIndex((a) => a === "-X" || a === "--method");
    if (idx >= 0) return (argv[idx + 1] ?? "").toUpperCase() === "GET";
    if (argv.some((a) => a === "-f" || a === "-F" || a.startsWith("--field"))) return false;
    return true;
  }
  const READS = new Set([
    "auth status",
    "pr list",
    "pr view",
    "pr diff",
    "issue list",
    "issue view",
    "run list",
    "run view",
    "label list",
    "repo view",
  ]);
  return READS.has(`${first} ${second}`);
}

/**
 * Run the real `gh` synchronously and return trimmed stdout. Throws on a
 * non-zero exit with scrubbed stderr in the message. `assertRead` (default on)
 * refuses to even spawn a mutating argv — the capture script never turns it
 * off; the sandbox harness does, explicitly, per mutation, after its own
 * allowlist checks.
 */
export function gh(argv, { assertRead = true } = {}) {
  if (assertRead && !isReadInvocation(argv)) {
    throw new Error(
      `refusing to run "gh ${redactArgvForLog(argv).join(" ")}": this runner only accepts read invocations`,
    );
  }
  try {
    return execFileSync("gh", argv, {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_PAGER: "", PAGER: "" },
    }).trim();
  } catch (err) {
    const stderr = scrubSecrets(err?.stderr ?? "");
    throw new Error(`gh ${redactArgvForLog(argv).join(" ")} failed: ${stderr || err.message}`);
  }
}
