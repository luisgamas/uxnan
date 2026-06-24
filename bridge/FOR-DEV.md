# FOR-DEV — uxnan-bridge

Deferred developer work for the bridge. Each item has a greppable `FOR-DEV:`
marker at its site in the code. (Distinct from `FOR-HUMAN.md`, which tracks assets
only a human can provide.)

> **How to run/validate everything** (automated tests, real-mobile E2EE interop,
> adapter wiring, contract re-checks) is in [`docs/testing.md`](docs/testing.md).
> The implemented surface is documented in [`README.md`](README.md) +
> [`docs/`](docs/); this file tracks only what's left to build.

## Status

The bridge is **alpha-functional** on its primary path (LAN/Tailscale-direct,
standalone). It builds clean and the suite is green (bridge 342, shared 29, relay
27). Nothing below blocks LAN/Tailscale-direct use. The only items that gate a
**public npm release** are the *Packaging* first-publish steps and real-device
push validation (FOR-HUMAN).

## Transport & connectivity

- [ ] **Key rotation / keyEpoch advance** — blocked on a mobile trigger. (Seq-based
      catch-up on reconnect is done end-to-end; only key rotation remains.)
- [ ] **Bind the LAN server to chosen interface(s)** — today it binds all
      interfaces (good for Tailscale; advertises virtual-NIC IPs too). Optionally
      let the user restrict which interfaces are served/advertised.

## Handlers

- [ ] **Checkpoints on an unborn branch** — `capture` requires at least one commit
      (no HEAD → `-32003`). Support checkpoints on an unborn branch if a use case
      appears. Low priority.
- [ ] **Interactive approvals — OpenCode / pi gap.** The headless modes the bridge
      drives (`opencode run --format json`, `pi -p --mode json`) run tools
      autonomously and emit tool events only **after** the tool ran — no way to gate
      them. Echo + Claude (`PreToolUse` hook) + Codex (`app-server`) + Gemini
      (`BeforeTool` hook) have real per-action approvals; OpenCode/pi get only the
      coarse `default`/`acceptEdits`/`bypassPermissions` posture. Real approvals
      would need driving `opencode serve` (HTTP, per-thread server session — a
      rewrite) or pi's `--mode rpc` (two-way, adapter refactor). Revisit when either
      CLI ships a stable pre-tool channel on its headless entry point.
- [ ] **Claude/Codex approval follow-ups** — map `approveSession` to a real
      session-scoped allow on the Claude hook path (today every tool re-asks; Codex's
      app-server already remembers `approved_for_session`); a per-turn allow-list so
      repeated identical tools aren't re-prompted; document that the Claude/Gemini
      hook URL needs the LAN port resolved (handled by the lazy `url()` after
      `startLan`, but worth a note).
- [ ] **Image attachments — follow-ups** — native per-CLI image input (a dedicated
      flag / MCP image part) where richer than a cwd-relative file path; add
      `.uxnan-attachments/` to a recommended `.gitignore` (cleaned per turn, but a
      crash mid-turn could leave one); on-device verify an agent actually reads the
      delivered image.
- [ ] **`auth/login` / `auth/logout`** — still stubs (driving a CLI's interactive
      login/logout). `auth/status` is done (sanitized, file-existence heuristic). An
      authoritative `requiresLogin` would run the CLI's own `whoami`/auth command
      instead of the heuristic (slower, per-CLI).
- [ ] **Desktop embedded-mode IPC** — `src/handlers/desktop-handler.ts` is an empty
      stub; no `desktop/*` contracts exist in `shared/`. This is the bridge half of
      the desktop's **Phase 6** (embedded sidecar + mobile pairing); see
      `uxnandesktop/architecture/02e-bridge-integration.md`. Unbuilt on both sides.
- [ ] **`bridge/disconnectPhone`** — removes the session but does not close the live
      transport (`FOR-DEV:` in `bridge-control-handler.ts`). Also close the live
      transport so the phone is dropped immediately.

## Agent adapters

- [ ] **Per-model run options — phase 4 (fast-mode / context variants).** Phases 1–3
      are DONE (reasoning effort wired per agent + the per-model option schema in
      `shared/` `agent/models` + the mobile data-driven renderer). Phase 4 is fast-
      mode / context-window variants as opt-in knobs **only where a real CLI flag
      exists**. Validated: Claude has **no** fast-mode/context argv flag, Codex/pi
      have no fast mode — so there is little to wire today. Keep the option schema
      forward-compatible (unknown `kind` ignored by the phone) and only advertise a
      knob that maps to a real flag.
- [ ] **pi context-window %** — pi reports raw `totalTokens` (shown as a count like
      Codex). Map the resolved model's context window (pi `--list-models` exposes it)
      so the phone can render a `%` ring instead of a count.

### Adding the next agent (recipe — do these one by one)

The OpenCode adapter is the template for any "one-shot per-turn CLI" agent:

1. Run the real CLI by hand once and capture a turn's machine-readable stream
   (`<cli> ... --json|--format json`). **Watch for stdin:** OpenCode hangs on an
   open stdin pipe — spawn with `stdio:['ignore','pipe','pipe']`.
2. Copy `opencode-adapter.ts`; adjust the args builder (`run/exec`, model flag,
   session/continue flag, cwd flag) and `parseLine` for that CLI's event shape.
   Keep `shell:false` and pass the prompt as an argv element (no injection).
3. Register it in `startBridge` with display metadata + availability. Then wire it
   into `agent/models` (discovery), the `*-tools.ts` block mapper (structured
   content), `SessionHistoryReader` (on-disk `turn/list` fallback), and approvals if
   the CLI exposes a pre-tool channel.

- [ ] **Aider** — the only remaining planned agent. Follow the recipe above.
- [ ] **Antigravity CLI (`agy`) — investigated, deliberately NOT integrated**
      (decided 2026-06-19; validated against `agy` 1.0.3 — trust the binary, the web
      docs are unreliable). `agy` is a distinct binary from Gemini CLI (own exe/state
      dir/hook file) and must NOT be wired through `gemini-adapter.ts`. Deferred
      because its headless `-p` surface is too thin for the agent contract the phone
      renders: **confirmed absent** `--model`, `--json`, `--output-format`,
      `--stream`, `--thinking`, `--approval-mode`, `--list-models`, `--session-id`,
      `-C/--cwd` → no streaming/structured blocks, no token usage, no model
      discovery/selection, no reasoning knob, no blocking pre-tool hook (only
      `Post*`), no headless plan/to-do, protobuf history (not the Gemini JSON
      format). Only continuity maps (`--continue`/`--conversation`). **Open blocker:**
      `agy -p` produced no output to a piped (non-TTY) stdout in repeated runs — may
      need a pty harness. **Unblock when** `agy` ships a machine-readable
      `--output-format json|stream-json`, and/or an app-server JSON-RPC turn protocol
      (as Codex did), and/or a documented blocking pre-tool hook. Until then no
      adapter and no `'antigravity-cli'` AgentId — a degraded text-only agent would be
      strictly worse than the existing CLIs.

## Daemon lifecycle & ops

- [ ] **Log size-rotation + retention** — `createFileLogger` does daily rotation +
      secret redaction; add size-based rotation + pruning of old log files.
- [ ] **Relay autostart** — only needed for remote/off-LAN (LAN-only needs no relay).

## Packaging — npm publish readiness

`bin`/`files`/`engines`/`repository`/`prepublishOnly` are set on all three packages,
and `.github/workflows/release-npm.yml` automates the tag-driven publish. What
remains is the **first actual publish**:

- [ ] **Pin `@uxnan/shared` for the registry** — publish `@uxnan/shared` first, then
      change the bridge/relay dep `"@uxnan/shared": "*"` → `"^0.x"` (the `*` workspace
      spec does NOT resolve from npm). The release workflow does this pin at publish
      time; verify it. Same for the bridge's `"uxnan-relay": "*"` devDependency (drop
      or pin; only the e2e test uses it).
- [ ] **Packed-install smoke** — `npm pack` each package, `npm install -g
      ./uxnan-bridge-*.tgz`, run `uxnan-bridge qr`.
- [ ] **Executable bit** — ensure `scripts/*.sh` keep their executable bit on the
      packed tarball.
- [ ] **OIDC publishing** — migrate from `NPM_TOKEN` to npm Trusted Publishing after
      the first publish; enable provenance.

## Ops / nice-to-haves

- [ ] **CLI version-update notice** — on startup compare `BRIDGE_VERSION` against the
      npm registry and print an upgrade hint (no auto-update; silent when offline).

## Known issues

- [ ] **Echo-agent E2E flaky on Windows CI** — the end-to-end turn-routing + approval
      round-trip tests in `bridge/test/handlers/thread-handlers.test.ts` intermittently
      never report `completed` on **Windows CI runners** (time out even at 120s), while
      passing reliably on Linux CI and on local Windows (the approval test runs in
      ~33 ms locally). Skipped on Windows CI only via `SKIP_ECHO_E2E_ON_WIN_CI`.
      Investigate the Windows stdio approval race (`src/agents/`,
      `ProcessAgentAdapter`'s stdin write + the approval round-trip) and remove the
      guard once fixed.

## Relay hardening (relay-only)

Multi-session `mac` registration + auth-on-forwarding are relay-only and tracked in
[`relay/FOR-DEV.md`](../relay/FOR-DEV.md) (the authoritative list). They do not block
the bridge.
