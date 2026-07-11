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
standalone). It builds clean and the suite is green (bridge 408, shared 36, relay
27). The **npm releases shipped** — `uxnan-bridge` is published to npm; releases
publish to the **`latest`** dist-tag (`@uxnan/shared` pinned to the same version by
the release workflow). Nothing below blocks LAN/Tailscale-direct use; the remaining
release follow-ups are the post-publish *Packaging* hardening items and real-device
push validation (FOR-HUMAN).

**Implemented (DONE):**

- **E2EE transport** — relay `mac` client + direct-LAN `http+ws` server,
  handshake, AES-256-GCM channel, byte-for-byte compatible with the mobile app;
  background reconnect loop; stable pairing session; mDNS discovery
  (`_uxnan._tcp.local`); manual-code pairing (`GET /pair/resolve?code=`).
- **OS-keychain identity persistence** + single-instance lock.
- **Real Git + Workspace handlers** — path-traversal-safe; working-tree
  checkpoints with **true restore** + retention pruning; `git/revert`,
  `git/deleteBranch`, `git/removeWorktree`, `workspace/exists`,
  `workspace/browseDirs`.
- **Conversation engine** — threads / turns + streaming, per-thread
  `Message.blocks` / `Message.thinking` / `Message.usage`, plus the ordered
  `Message.segments` interleave (text runs + work-log/diff/tool blocks in
  production order) so a `turn/list` re-sync renders the work log inline with
  the response instead of stacking all activity above one merged paragraph.
- **7 real agents wired** — OpenCode (default), Claude Code, Codex, pi,
  Gemini CLI, Zero, and Grok. Each drives its **official local CLI** with
  `shell:false`, parses the native stream, and emits structured
  `stream/content/block` events (command / diff / tool) plus
  `stream/thinking/delta` (reasoning). Most spawn the CLI over stdio; the
  server-based adapters run a long-lived local process instead — **Codex**
  JSON-RPC over `codex app-server` stdio, **Zero** and **Grok** JSON-RPC over the
  Agent Client Protocol (`zero acp` / `grok agent stdio`, NDJSON over stdio —
  reusing the Codex NDJSON transport, with **real `session/request_permission`
  approvals**), and **OpenCode** HTTP + SSE over `opencode serve` (loopback). No
  further agent is planned right now.
- **Per-thread agent/project selection** + per-project agent/model pins
  (`projectAgents` config); per-model run-option knobs advertised on
  `agent/models`; per-turn token usage on `stream/turn/completed`.
- **Full thread lifecycle** — `thread/rename|archive|unarchive|delete`.
- **Plug-and-play folder browsing** — `workspace/browseDirs` with a
  `browseRoots` config.
- **Direct FCM push from the bridge** — primary path, persisted across restarts,
  per-phone target, prune-on-untrust. `firebase-admin` is an `optionalDependency`
  (no creds = silent no-op; foreground local notifications still work).
- **Sanitized per-agent `auth/status`** — never tokens; login detected by
  auth-file existence only.
- **Interactive approval intake** — Echo demo + Claude Code opt-in `PreToolUse`
  hook + Codex via the `codex app-server` turn protocol + OpenCode via
  `opencode serve` `permission.asked` + Gemini `BeforeTool` hook + Zero and Grok
  via ACP `session/request_permission`; all routed through one `requestApproval`
  round-trip, validated end-to-end.
- **Image attachments** — CLI-agnostic file-path, sandbox-safe.
- **On-disk `turn/list` history fallback** for Claude / Codex / OpenCode / pi /
  Gemini JSONL/JSON stores.
- **Bridge control** — `bridge/status` (real `relayConnected`),
  `bridge/removeTrustedDevice` (revokes + drops session + prunes push
  registration), `bridge/trustedDevices`, `bridge/connectedPhones`,
  `bridge/generatePairingQr`.
- **Autostart** (`install-service` / `uninstall-service` per platform, never
  elevated), file logging with secret redaction, and the
  `start`/`stop`/`status`/`qr`/`code`/`install-service` CLI.

## Transport & connectivity

- [ ] **Key rotation / keyEpoch advance** — blocked on a mobile trigger. (Seq-based
      catch-up on reconnect is done end-to-end; only key rotation remains.)
- [ ] **Bind the LAN server to chosen interface(s)** — today it binds all
      interfaces (good for Tailscale). Advertised hosts already EXCLUDE host-only
      virtual adapters (Hyper-V/WSL/Docker/VirtualBox/VMware) via
      `isVirtualInterfaceName` in `local-hosts.ts`, so the phone no longer burns a
      connect timeout on a dead `172.x` virtual-NIC address. Remaining (optional):
      let the user restrict which interfaces are *served* (bound), and let them
      whitelist an unusual advertised address the name-based filter would skip.

## Handlers

- [ ] **Checkpoints on an unborn branch** — `capture` requires at least one commit
      (no HEAD → `-32003`). Support checkpoints on an unborn branch if a use case
      appears. Low priority.
- [ ] **Interactive approvals — pi gap.** pi's headless mode (`pi -p --mode json`)
      runs tools autonomously and emits tool events only **after** the tool ran — no
      pre-tool channel to gate them, so pi surfaces `autonomous: true` (chip + banner)
      instead of approvals. Echo + Claude (`PreToolUse` hook) + Codex (`app-server`) +
      OpenCode (`opencode serve` `permission.asked`) + Gemini (`BeforeTool` hook) +
      Zero (`zero acp` `session/request_permission`) all have real per-action
      approvals. Real pi approvals would need its `--mode rpc`
      (two-way, adapter refactor); revisit when pi ships a stable pre-tool channel on
      a headless entry point.
- [ ] **OpenCode access-mode — mid-thread per-turn re-apply.** The thread's
      `accessMode` is mapped to a permission ruleset and passed on `POST /session`
      (`opencode-adapter.ts` `#rulesetFor`), so it governs an OpenCode thread from its
      first turn. A mid-thread access-mode change does NOT recreate the session, so
      the new posture only applies to threads started after the change (same shape as
      the Codex caveat below). Resolve by confirming whether `opencode serve` accepts
      a per-turn permission override (or `PATCH /session/{id}`), or recreate the
      session when the mode changes.
- [ ] **Codex access-mode — mid-thread per-turn re-apply.** The thread's
      `accessMode` is mapped to `(approvalPolicy, sandbox)` and sent on
      `thread/start` (`codex-adapter.ts` `#effectiveMode`), so it governs a Codex
      thread from its first turn. A mid-thread access-mode change does NOT re-issue
      `thread/start`, so the new posture only applies to threads started after the
      change. Resolve by confirming (against a live `codex app-server`) whether
      `turn/start` accepts an approval/sandbox override per turn, or restart the
      app-server thread when the mode changes. (Gemini has no such caveat — it
      spawns one CLI per turn.)
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
- [ ] **`agent/usageStats` handler** — the contract exists in `shared`
      (`ProviderUsage`; see `architecture/02a` §5.8.10 / `02b`) and the desktop
      already reads AI-provider usage natively in Rust (`uxnandesktop/src-tauri/src/usage.rs`).
      The bridge must implement the **same reader in TS** (Codex/Claude/Copilot/Gemini:
      each CLI's stored token → its official usage API, never cookies / pasted keys)
      and serve `agent/usageStats`, so a paired phone — which can't see the PC's disk —
      gets the same data (dual-reader, one contract). Mobile UI is owed in
      `uxnanmobile/FOR-DEV.md`. Natural pilot for the Phase 6 embedded bridge.
- [ ] **Desktop embedded-mode IPC** — `src/handlers/desktop-handler.ts` is an empty
      stub; no `desktop/*` contracts exist in `shared/`. This is the bridge half of
      the desktop's **Phase 6** (embedded sidecar + mobile pairing); see
      `uxnandesktop/architecture/02e-bridge-integration.md`. Unbuilt on both sides.
- [ ] **`bridge/disconnectPhone`** — removes the session but does not close the live
      transport (`FOR-DEV:` in `bridge-control-handler.ts`). Also close the live
      transport so the phone is dropped immediately.

## Conversation history

- [ ] **On-disk history fallback — ordered `segments`.** The live/stored path
      (`thread-store.ts`) emits `Message.segments` (interleaved text↔work-log
      order), so a phone reconnecting to a still-running bridge recovers the real
      order. The **on-disk `turn/list` fallback** (`session-history.ts`, used only
      after a bridge restart with an empty `threads.json`) still emits
      `content` + `blocks` separately, so a recovered turn renders blocks-first
      (the phone falls back to `_assistantContents`). Reconstruct `segments` from
      each CLI log's real text↔tool order (Claude `tool_use` is interleaved in the
      assistant `content`; Codex/pi attach tool blocks after the text; OpenCode
      parts are read in file order; Gemini bundles `toolCalls` per message) and
      attach them to each `RawMessage`. See the `FOR-DEV:` marker in
      `session-history.ts`.

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
- [ ] **Zero token usage** — the Agent Client Protocol carries no per-turn
      token/context usage, so `ZeroAdapter` reports `reportsContextUsage:false` and the
      phone shows no context meter for Zero. Read usage from `zero usage` (or Zero's
      on-disk session store) and emit `usage` on `stream/turn/completed` so the meter
      lights up. See the `FOR-DEV:` marker in `zero-adapter.ts`.
- [ ] **Zero on-disk history fallback** — there is no `SessionHistoryReader` for
      Zero's ACP sessions yet, so a `turn/list` after a bridge restart returns nothing
      for a Zero thread (live/in-memory history still works). Parse Zero's on-disk ACP
      session store (via `session/load`) and wire it into `session-history.ts` like the
      Claude/Codex/OpenCode/pi/Gemini readers.
- [ ] **Interactive `ask_user` for Zero** — Zero's `ask_user` tool is **non-interactive
      over ACP**: Zero's ACP agent (`internal/acp/agent.go`) wires no `OnAskUser` handler,
      so the loop auto-completes the call with "proceed with your best assumption" and
      never routes it to the client. The bridge therefore can't turn it into the
      interactive question card (the way OpenCode's `question` tool works); it only
      renders the questions legibly (`zero-tools.ts` `formatAskUser`). Making it
      answerable needs Zero to route `ask_user` to the ACP client (an **upstream** change,
      e.g. a vendor `_zero/ask_user` request or reusing `session/request_permission`);
      once it does, wire it into the existing `requestQuestion` round-trip.
- [ ] **Grok live-turn verification (balance-blocked)** — the ACP envelope,
      handshake and model discovery were exercised against a live `grok 0.2.93`, but
      a real turn could **not** be run because the test account's Grok Build balance
      was exhausted (HTTP 402 from `cli-chat-proxy.grok.com`). Re-verify against a
      funded account: the per-turn `session/update` `tool_call`/`plan` shapes and
      arg names (`grok-tools.ts` assumes ACP-standard `kind`/`rawInput`/`content`),
      the `session/request_permission` option `kind`s, whether Grok emits token
      usage, and whether `session/set_mode { modeId: <effort> }` actually applies the
      reasoning effort (it accepts any modeId without error). See the FOR-DEV notes
      in `grok-adapter.ts` / `grok-tools.ts`.
- [ ] **Grok token usage** — like Zero, `GrokAdapter` reports
      `reportsContextUsage:false` (no per-turn usage was observed over ACP). If Grok
      exposes usage (its `/context` command implies it tracks it), emit `usage` on
      `stream/turn/completed` so the phone's context meter lights up.
- [ ] **Grok on-disk history fallback** — there is no `SessionHistoryReader` for
      Grok's ACP sessions yet, so a `turn/list` after a bridge restart returns nothing
      for a Grok thread (live/in-memory history still works). Parse Grok's on-disk
      session store (`~/.grok/…`, via `session/load`) and wire it into
      `session-history.ts` like the Claude/Codex/OpenCode/pi/Gemini readers.
### Adding the next agent (recipe — do these one by one)

Pick the template that matches the CLI's headless surface. For a **one-shot
per-turn CLI** (spawns once per turn) copy `gemini-adapter.ts` or `pi-adapter.ts`;
for a **long-lived server** with a pre-tool approval channel copy `codex-adapter.ts`
or `zero-adapter.ts` (JSON-RPC over stdio) or `opencode-adapter.ts` (HTTP/SSE over
`opencode serve`).

1. Run the real CLI by hand once and capture a turn's machine-readable stream
   (a `--json|--format json` one-shot, or the server's event stream). **Watch for
   stdin:** the one-shot CLIs hang on an open stdin pipe — spawn with
   `stdio:['ignore','pipe','pipe']`.
2. Copy the closest template; adjust the args/request builder (subcommand, model
   flag, session/continue flag, cwd) and the event parser for that CLI's shape.
   Keep `shell:false` and pass the prompt as an argv element / request body (no
   injection).
3. Register it in `startBridge` with display metadata + availability. Then wire it
   into `agent/models` (discovery), the `*-tools.ts` block mapper (structured
   content), `SessionHistoryReader` (on-disk `turn/list` fallback), and approvals if
   the CLI exposes a pre-tool channel.

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
and `.github/workflows/release-npm.yml` automates the tag-driven publish. The
**first publish shipped** (`0.0.1-alpha.20260627`, `alpha` dist-tag) — the workflow
pinned `@uxnan/shared` to the exact version at publish time, validated by the
successful run. Remaining post-publish hardening:

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
