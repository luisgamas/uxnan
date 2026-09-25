# Chat tabs and the bridge connection

A **chat tab** shows a conversation with an agent that the **Uxnan bridge**
drives — the same conversations Uxnan Mobile shows. Both apps are clients of
one owner: whatever you do in one (send a message, stop a turn, answer an
approval, rename, switch the model) shows up in the other as it happens.

Terminals are unchanged: an agent launched in a terminal is still its own TUI,
driven by you through the PTY. A chat is the other way to run an agent — as a
conversation you can take with you.

Architecture: [`architecture/02a-system-architecture.md`](../../architecture/02a-system-architecture.md)
§5.8.15 (the local control channel) and §5.8.16 (how clients converge);
[`architecture/02e-bridge-integration.md`](../architecture/02e-bridge-integration.md) §3.5.

## Connecting to the bridge

**Settings → Bridge & mobile → Connection** (`settings.bridge.mode`):

| Mode | What the app does |
|---|---|
| **Off** (default) | Nothing: no socket, no file read, no timer, no process. Chat tabs say the bridge is off and offer *Connect*. |
| **Use a running bridge** (`attach`) | Connects to a bridge you already run — as a service (`uxnan-bridge install-service`) or with `uxnan-bridge start` in a terminal. |
| **Start the bridge when needed** (`managed`) | Same, but when none is running it starts `uxnan-bridge start` itself (resolved on `PATH`, like any agent CLI) and stops it — through `uxnan-bridge stop`, so the bridge releases its lock cleanly — when the app exits. A bridge you started yourself is never stopped. |

**Installing and updating it from the app.** When `uxnan-bridge` is not on
`PATH`, a chat tab says so and offers **Install** right there, with the command
underneath for whoever prefers a terminal; Settings → Bridge & mobile has the
same **Install** / **Update** next to the installed and newest versions, plus
**Check again** (re-reads what is installed and retries the connection). Both
run `npm install -g uxnan-bridge@latest` — only when you press the button — and
show npm's output. If Uxnan runs the bridge (`managed`) it restarts it on the
new version; a bridge you run yourself keeps running and the status row offers
**Restart the bridge**. Node.js 18+ (and its `npm`) must be installed; without
it the row says so. **Update automatically** (off by default) updates the bridge
Uxnan runs as soon as a newer one is published, waiting until no conversation is
running on any device.

The status row names the state and, when the bridge is unreachable, why and what
fixes it:

| Status | Meaning |
|---|---|
| Connected — bridge `x.y.z` | Live. "started by Uxnan" when `managed` launched it. |
| No bridge is running | Nothing holds the bridge's lock (`~/.uxnan/bridge.lock`). Start it, or switch to *Start the bridge when needed*. |
| Too old to talk to Uxnan Desktop | A bridge is running, but it was released before the desktop channel and does not publish it. **Update**; in `managed` mode Uxnan then restarts it on the new version. |
| Running without the desktop channel | A bridge that knows the channel is running without it: an older process still runs after an update (**Restart the bridge**), or it was started with `localControlEnabled: false` in `~/.uxnan/daemon-config.json`. |
| Not installed | `managed` found no `uxnan-bridge` on `PATH`. |
| Refused this app | A bridge answered but rejected the token — typically another user's bridge, or a stale file. |
| Could not connect | Anything else — including a bridge Uxnan started that exited at once; the detail line says what, and the bridge's log is in `~/.uxnan/logs/`. |

The last three states used to read as "no bridge is running": the app now reads
the bridge's lock file to tell a bridge that is not there from one that is there
but cannot talk to the desktop, and `managed` never starts a second bridge over
one that holds the lock.

While connected, the section also lists the phones connected to the bridge.
Pairing a phone is still done from a terminal (`uxnan-bridge qr` or
`uxnan-bridge code`).

### How the connection works

The bridge publishes `~/.uxnan/local-control.json` — its loopback port and a
token minted fresh at every start, owner-only (`0600`). The backend
(`src-tauri/src/bridgeclient/`) reads it, opens
`ws://127.0.0.1:<port>/control?client=desktop` with the token, and from then on
calls the bridge's JSON-RPC methods and receives its `stream/*` notifications
exactly as a phone does. The token never leaves the Rust side: the window only
sees the status (`bridge:status`), the notifications (`bridge:notification`)
and call results (`bridge_call`). After a reconnect the bridge replays what the
app missed, or says it cannot (a restart), and the app re-reads what it shows.

## Opening a chat

Chats are offered for folders on **this** machine (the bridge runs here, so a
folder on an SSH host is not one it can work in):

- the tab strip's **+** → *Chat* → **New chat**, plus the folder's three newest
  conversations (one started on the phone included);
- a worktree row's right-click → *Launch agent* → **New chat**;
- the project card's launcher dialog → *What to open* → **Chat**.

## In the sidebar

A worktree's agent view lists its bridge conversations next to its terminal
agents, in the same rows (`ChatRow`): the state glyph, the agent's mark, the
title and when it last moved; a second line says what it is doing, or — idle —
that it is a chat and on which model. Listed are every conversation open in a
tab or doing something, then the most recent others up to four
(`sidebarChats`); a conversation started on the phone appears as soon as the
bridge knows it. A click opens it in a chat tab, or focuses the tab showing it.

The state is the one every chat surface reads (`ThreadActivity`), the same five
a terminal agent shows: **working** while a turn runs, **waiting** while an
approval or a question waits on you, **blocked** when the last turn failed,
**done** when a turn finished and you have not looked yet, and idle. It comes
from the bridge's own stream — turns starting and ending, requests raised and
resolved — so a chat needs no hooks; right after connecting, `thread/list`'s
live `activeTurnId` says which conversations are already working. Chats count
toward the worktree's leading state, its "last moved" time, the needs-you
count and the sidebar's status order.

**Names.** A chat's title is its thread's, the same on every client: renaming
the tab renames the thread (`thread/rename`), a rename on the phone shows here,
and a name given to a new chat's tab before its first message becomes the
thread's name.

## The chat's agent gets Uxnan's tools

While the desktop is connected, the agent of a chat gets the same MCP server the
agents launched in a terminal get — the browser, terminals, other agents, the
whole control catalog — scoped to the project the conversation's folder belongs
to (`docs/control-api.md` → *Callers*). The desktop hands the bridge its
endpoint and a token of its own for chat agents (`desktop/attach`, over the
local channel only; the token rotates on every start and the bridge forgets it
when the desktop disconnects). Settings → Browser's switch that gives the
agents Uxnan's tools (`mcpEnabled`) governs chats too. Today the bridge
registers it for **Claude Code**; the other agents it drives are listed in
`bridge/FOR-DEV.md`.

## A new chat

A new chat opens on one question — *What should we build in <folder>?* — over
the composer. Its toolbar carries the **agent** (it stays with the
conversation, because another CLI cannot continue a native session) and,
optionally, a **model** (*Default model* lets the agent decide). The first
message starts the thread in the tab's folder; the thread is titled from that
message until the agent writes a better name.

Below it, **Continue a conversation** lists every conversation the bridge holds
for this folder, whichever app started it.

Agents offered are the bridge's (`agent/list`), not the desktop's agent
profiles: a chat runs on the bridge's drive surface for each CLI
(`bridge/docs/agents.md`), so availability is what the bridge resolves.

## In a chat

- **Header**: the conversation's name, its agent (fixed), and *Rename* (renames
  the thread, so the phone shows the same name) / *Archive*.
- **Timeline, while a turn runs**: everything in view, in the order the agent
  produced it — prose, and between it the steps it takes. Consecutive steps
  (commands, edits, tool calls, subagents) form one **work group**: a compact
  row per step (icon, verb, detail; a pulsing dot while it runs, red when it
  failed), each one opening to its output or diff. A *Working for 12s* line
  sits under the turn.
- **Timeline, once a turn settles**: the work that led to the answer folds
  behind one line — *Worked for 1m 3s* (or *Stopped after …* / *Failed after
  …*) — which opens back to it, each work group then closed to its summary
  (*Ran 3 commands · 2 edits*, and how many failed). The closing answer stays
  open, followed by a card of the **files the turn changed** (+/− per file; a
  click opens the file). *Thinking* folds away. Scrolling to the top loads older
  turns.
- **Messages**: hovering one shows when it was sent and a copy button.
- **Approvals and questions** wait in a dock **pinned above the composer**
  until they are answered; the timeline keeps a one-line record of each (what
  was asked, then how it ended). One answered on the phone (or timed out)
  settles here too; one from a turn that already ended never offers its buttons
  again.
- **Queue**: a message sent while the agent works is queued behind the running
  turn (or handed to it, on agents that take input mid-turn); queued messages
  are listed in the dock, each with **Edit** (takes it off the queue and puts
  it back in the composer — only once the bridge confirms) and cancel. A
  stopped or failed turn pauses the queue: *Resume* or *Discard*.
- **Drafts and recall**: the composer's unsent text is the tab's draft, saved
  with the layout, so it survives switching tabs and restarting. On an empty
  composer **↑** recalls the thread's earlier messages (newest first) and **↓**
  walks back. A message that failed to send offers **Edit** (back into the
  composer) or *Dismiss*; nothing put back ever overwrites text being written —
  it is added below it.
- **Composer**: Enter sends, Shift+Enter breaks the line; while the agent works
  the round button stops it. Its toolbar holds what can change mid-chat — the
  model (every client sees the change), the model's knobs (reasoning effort, …)
  when it has any, and the access mode (*Ask first* / *Auto-approve edits* /
  *Full access*; new chats start at *Full access*, like new chats on the phone)
  — and a ring showing how full the context window is, when the agent reports
  it (amber past 75%, red past 90%; the figures are in its tooltip).

## For developers

- Stores: `src/lib/bridge/client.svelte.ts` (connection + call + notification
  fan-out), `chat.svelte.ts` (thread list, actions), `conversation.svelte.ts`
  (one thread's timeline reducer, including `openRequests` for the dock),
  `timeline.ts` (pure: grouping a turn's parts into work groups, splitting the
  closing answer, work summaries, changed files, durations) and
  `streamingMarkdown.ts` (the phone's streaming split and render window).
- **Streaming performance.** Deltas are coalesced per render window
  (`streamCoalesceWindow`: 16–100 ms by reply length) and a reply renders as
  settled Markdown chunks, one `MarkdownView` each, so only the chunk being
  written re-renders. To measure a change, stream a long synthetic reply at the
  bridge's 25 ms batch in a browser with the CPU throttled (6×) and compare
  script time, long tasks and the worst frame before and after. Components:
  `src/lib/components/chat/`.
- The conversation model is the bridge's own, imported **type-only** from
  `shared/src` through the `$shared` alias (`svelte.config.js`): no copy that can
  drift.
- A chat tab (`ChatTab` in `terminals.svelte.ts`) persists only `cwd`,
  `threadId` and the preselected `agentId`.
- Tests: `src/lib/bridge/*.svelte.test.ts`, `src/lib/bridge/timeline.test.ts`,
  `src/lib/components/ChatRow.svelte.test.ts`,
  `src/lib/components/BridgeSettings.svelte.test.ts`,
  `src/lib/state/chatTabs.svelte.test.ts`,
  `src/lib/components/chat/ChatBlock.svelte.test.ts`, and in Rust
  `cargo test bridgeclient` — which includes a contract test against the real
  built bridge (`bridge/dist`; skipped when it is not built).
- To iterate on the chat UI in a plain browser (`npm run dev`) there is no
  backend, so a chat tab shows the "bridge is off" state; drive the real flow
  with `npm run tauri dev` and a running bridge.
- To drive it against the bridge in this checkout (for instance before a bridge
  release carries a contract change): `npm run build` at the repository root,
  stop any other bridge (`uxnan-bridge stop`), run
  `node bridge/dist/src/cli.js start`, and pick *Use a running bridge*.
