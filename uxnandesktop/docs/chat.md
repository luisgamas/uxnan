# Chat tabs and the bridge connection

A **chat tab** shows a conversation with an agent that the **Uxnan bridge**
drives — the same conversations Uxnan Mobile shows. Both apps are clients of
one owner: whatever you do in one (send a message, stop a turn, answer an
approval, rename, switch the model) shows up in the other as it happens.

Terminals are unchanged: an agent launched in a terminal is still its own TUI,
driven by you through the PTY. A chat is the other way to run an agent — as a
conversation you can take with you.

Architecture: [`architecture/02a-system-architecture.md`](../../architecture/02a-system-architecture.md)
§5.8.15 (the local control channel), §5.8.16 (how clients converge) and §5.8.17
(one layer: the bridge as the source of truth);
[`architecture/02e-bridge-integration.md`](../architecture/02e-bridge-integration.md) §3.5.

## Connecting to the bridge

**Settings → Bridge & mobile → Connection** (`settings.bridge.mode`):

| Mode | What the app does |
|---|---|
| **Off** | Nothing: no socket, no file read, no timer, no process. Chat tabs say the bridge is off and offer *Connect*. A state saved before keeps whatever mode it had, `off` included. |
| **Use a running bridge** (`attach`) | Connects to a bridge you already run — as a service (`uxnan-bridge install-service`) or with `uxnan-bridge start` in a terminal. |
| **Run it as a service** (`managed`, a fresh install's default) | Same, but when none is running Uxnan makes sure the bridge runs as **your user's service**, in this order: the registered service is started; an independent `uxnan-bridge` on `PATH` is registered (never duplicated); with neither, **the bridge Uxnan carries** is installed and registered ([bridge-runtime.md](./bridge-runtime.md)). All through the bridge's own CLI (`service-status` → `install-service` → `service-start`, `bridgeclient/service.rs`). The service keeps serving the phone while Uxnan is closed, so the app never stops it on its own. |

**The bridge Uxnan carries.** Every installer ships a private bridge — Node.js
and `uxnan-bridge` from the same commit — so nothing needs installing, not even
Node. When there is no bridge, a chat tab says so and offers **Set up the
bridge**; Settings → Bridge & mobile has the same next to the version, plus
**Use Uxnan's bridge** in place of an independent one that is too old to talk
to the desktop or does not start, **Remove the bridge** (its service and
runtime — never `~/.uxnan`), and **Check again** (re-reads what is installed,
asks the running bridge for the newest version right now —
`bridge/checkForUpdate` — and retries the connection). The app never runs npm.

**Who updates it** (architecture/02a §5.8.18, `BridgeStatus.host.install`):

- **The bridge Uxnan carries** (`bundled`) updates **with the app**. When the
  app updates and carries a newer bridge, it switches to it at a moment no
  turn runs on any client — verified before anything stops, and put back on the
  previous one if the new one does not come up. It never asks npm.
- **An independent bridge** (`npm`) **updates itself**: it checks for a newer
  version every hour; the sidebar's **Bridge** row then turns its badge blue
  (**New version**), the Bridge window offers it, and Settings → Bridge & mobile
  shows **Update**. Either asks the bridge (`bridge/update`): it stops, installs
  the published version and its service brings it back. It never happens under
  a running turn. **Update automatically** (off by default) asks as soon as a
  newer version is published. One that cannot update itself (started in a
  terminal, or older than updating itself) is offered **Use Uxnan's bridge**
  instead, never swapped unasked.

The status row names the state and, when the bridge is unreachable, why and what
fixes it:

| Status | Meaning |
|---|---|
| Connected — bridge `x.y.z` | Live. "kept running by Uxnan" in `managed` mode. |
| No bridge is running | Nothing holds the bridge's lock (`~/.uxnan/bridge.lock`). Start it, or switch to *Start the bridge when needed*. |
| Too old to talk to Uxnan Desktop | A bridge is running, but it was released before the desktop channel and does not publish it. **Use Uxnan's bridge** puts the one the app carries in its place. |
| Running without the desktop channel | A bridge that knows the channel is running without it: an older process still runs after an update (**Restart the bridge**), or it was started with `localControlEnabled: false` in `~/.uxnan/daemon-config.json`. |
| No bridge on this computer yet | `managed` found no bridge, and this build carries none to set up (a development build: it sets up the bundled bridge only when asked). |
| Could not start the service | `managed` could not install or start the bridge's service; the detail line quotes the bridge's own error. |
| Refused this app | A bridge answered but rejected the token — typically another user's bridge, or a stale file. |
| Could not connect | Anything else — including a bridge Uxnan started that exited at once; the detail line says what, and the bridge's log is in `~/.uxnan/logs/`. |

The last three states used to read as "no bridge is running": the app now reads
the bridge's lock file to tell a bridge that is not there from one that is there
but cannot talk to the desktop, and `managed` never starts a second bridge over
one that holds the lock.

While connected, the section also lists **every paired phone** — named as
every client names it (`sync/changes.devices`, `stream/devices/updated`), with
its model, OS and app version and whether it is connected now (presence,
`stream/presence/updated`) — and, when it is, **how**: *LAN* (the same
network), *Tailscale* or *Relay*, from presence's `route` (a bridge too old to
report it shows no label; the **Bridge** window's device list shows the same
label). A phone is renamed in place (`device/rename`; the
latest rename wins, even one made on the phone offline) or unpaired
(`bridge/removeTrustedDevice`). **Connect a phone** — also in the **Bridge**
window, one click away from the left sidebar's **Bridge** row under Search
(its badge's own colour is the state: green *Online*, amber *Starting* or
*Attention*, red *Stopped* or *Failed*, blue *New version* or *Updating*; beside it, how many phones are connected now; the window
holds the bridge's state and update, every paired phone and connected desktop
with whether each is connected, and this QR) — shows a QR drawn from the running bridge's own payload (its LAN hosts, its session, the pairing window
armed — the one `uxnan-bridge start` prints), with its countdown and *New
code*, and under it the same bridge's manual code (`bridge/pairingCode`, the
one `uxnan-bridge code` prints) with a copy button, for a phone that types it
instead of scanning (a bridge older than that method shows the QR alone);
with the bridge off it offers to run it as your service first, and it
notices the phone arrive (a new entry in the bridge's list, or a paired phone
connecting) and names it. Several phones can be paired. **Shared with your phones** holds the
**Computer name** every client shows for this PC and the **Start folder** the
bridge explores new projects from, on the phone and here alike
(`settings/set`).

### Remote access (your own relay)

**Settings → Bridge & mobile → Remote access** is how a phone reaches this
computer away from home. The bridge owns the relay (architecture/02a §5.10): it
deploys it into your Cloudflare account, keeps it connected and reports it; the
app only asks, through `relay/*`, and follows `stream/relay/updated`
(`$lib/bridge/relay.svelte.ts` is the one copy of that status here; spec:
`architecture/02e` §5.4).

- **Not set up:** the three ways a phone connects — the same Wi-Fi (works
  already), Tailscale (works automatically with it on both; the pairing QR
  carries those addresses) and your own relay (any network). **Set up your
  relay** asks for your Cloudflare **account ID** (Workers & Pages overview)
  and an **API token** made from the *Edit Cloudflare Workers* template at
  `dash.cloudflare.com/profile/api-tokens`, then the bridge deploys it
  (`relay/setup`, up to about a minute). The token is sent once and the field
  is emptied as soon as the bridge answers; **Remember the token on this PC
  (system keychain)**, off by default, lets the bridge keep it for a later
  update or removal. **Use a relay you deployed** takes the address of one you
  run yourself (`relay/use`) and shows this computer's key, which that relay
  must list in `UXNAN_HOST_KEYS`.
- **Set up:** **Use the relay** (on/off, `relay/set`), its state with the
  bridge's reason when it cannot connect, the phones using it now, its address,
  its version with **Update relay** when the bridge ships a newer one
  (`relay/update`; asks for the token when none is remembered; a relay you
  deployed yourself is updated where you deployed it), **New address**
  (`relay/rotate` — phones away from home reconnect after their next visit to
  the home network) and **Remove** (`relay/remove`, optionally deleting it from
  Cloudflare too).
- **No bridge, or one older than `relay/*`:** the section stays, disabled, with
  the reason.

Once a relay is set up, the **status bar** carries a relay indicator beside the
backend one (`RelayStatusButton.svelte`; the same icon-trigger + status popover
as the ports and usage indicators). Its cloud icon says the state at a glance,
and a connected relay has two looks, because being connected is not being used:
phones on the same network or over Tailscale reach the bridge directly and never
touch it. **Standing by** (connected, `relay/status.connectedPhones` is 0) is as
quiet as off — a muted icon, *Ready — no phone is using it (phones on this
network connect directly)* on hover. **In use** (one phone or more on it) is the
only lit look: a green icon with the count beside it (the orchestration count's
shape), *Carrying N phone(s)* on hover. The rest are unchanged — amber
*Connecting…*, red *Can't connect*, muted *Off* — and a dot marks a newer relay
to deploy. The popover shows the state (*Ready* / *In use* while connected) with
the bridge's reason when it cannot connect, the relay's address, the phones on
it (the relay's own count, named from presence where `route` is `relay`; with
none, it says phones on the same network or over Tailscale connect directly),
the deployed version, **Update relay** when the bridge ships a newer one, and
**Remote access settings**; both open Settings → Bridge & mobile scrolled to
Remote access, where the update (and its token prompt) lives. Like the ports and
usage indicators, it is hidden when there is nothing to say: no bridge, a bridge
older than `relay/*`, or no relay set up. It reads the same two replicas as
Settings (`relay` and `chat.clients`) and keeps no state of its own.

## One list of projects with the phone

Your projects here and the phone's are the bridge's one registry
(`projects.json`, architecture/02a §5.8.17), mirrored both ways by
`src/lib/bridge/projectMirror.svelte.ts`: a project you add here is published
to the registry, one the phone adds appears here, and removing one on either
side removes it on the other — its conversations are never deleted: they list
under *No project* (the Conversations tab, scope *All*) until the project is
added again, and continuing one never brings the project back (architecture/02a
§5.8.17). After every full sync the two lists **converge** without trusting
that every removal arrived: the mirror remembers, in the window's storage and
per bridge state (`storeId`), which local projects it has seen in the registry
(`uxnan.bridge.projectMirror`). A mirrored project the registry no longer has
was removed elsewhere while this window could not hear it — it is removed here
too; one the registry never had (added here while the bridge was away) is
published; a registry project with no local twin is added here. A removal made
here while the bridge was unreachable waits in the same record and is sent on
the next sync. Only local projects take part (an SSH project is on another
machine). Folders are compared through the bridge's own resolution, which
follows symlinks and maps a worktree to its repository.

The chat's data is a **replica** (`src/lib/bridge/chat.svelte.ts`): threads,
projects, the shared settings and presence converge through `sync/changes` on
every (re)connect and whenever a notification's revision is not the next one —
never by trusting that every notification arrived. A conversation's turns are
ordered by the bridge's `Turn.seq`.

### How the connection works

The bridge publishes `~/.uxnan/local-control.json` — its loopback port and a
token minted fresh at every start, owner-only (`0600`). The backend
(`src-tauri/src/bridgeclient/`) reads it, opens
`ws://127.0.0.1:<port>/control?client=desktop-<profile>` with the token, and from then on
calls the bridge's JSON-RPC methods and receives its `stream/*` notifications
exactly as a phone does. The token never leaves the Rust side: the window only
sees the status (`bridge:status`), the notifications (`bridge:notification`)
and call results (`bridge_call`). After a reconnect the bridge replays what the
app missed, or says it cannot (a restart), and the app re-reads what it shows.

The client id is derived from the app's profile directory (`desktop-` + 12 hex
of its SHA-256), so it is stable across restarts and differs between the
installed app, a development build and a disposable `UXNAN_DATA_DIR`. The
channel keeps one live connection per id: two apps sharing one would knock each
other off in a reconnect loop (the windows flicker and the chat freezes).

## Opening a chat

Chats are offered for folders on **this** machine, and for a folder on an SSH
host while **that host's own bridge** is connected — the account there runs
`uxnan-bridge`, and the conversation runs on it, with that machine's agents and
sign-ins (`docs/remote-hosts.md`). A host without one is not offered a chat;
a host chat tab whose bridge goes away says so, and comes back with it:

- the tab strip's **+** → *Chat* → **New chat**, plus the folder's three newest
  conversations (one started on the phone included);
- a worktree row's right-click → *Launch agent* → **New chat**;
- the project card's launcher dialog → *What to open* → **Chat**.

## In the sidebar

A worktree's agent view lists its bridge conversations next to its terminal
agents, in the same rows (`ChatRow`): the state glyph, the agent's mark, the
title and when it last moved; a second line says what it is doing, or — idle —
that it is a chat and on which model. Like a terminal agent, a chat is listed
while it is **open in a tab** or while it **needs attention** (working, waiting
on you, failed, finished and not yet seen) — never the idle history
(`sidebarChats`). A click opens it in a chat tab, or focuses the tab showing
it; right-click offers its actions. "Not yet seen" survives a restart or an
update: a chat that finished while the app was closed, or before you opened
it, is still listed until you open it (see the state below).

## A chat's lifecycle

The bridge owns every conversation, so these mean the same on the desktop and
the phone:

| Action | What happens | Where |
|---|---|---|
| **Close the tab** | Only the view closes. The conversation goes on (a running turn keeps running) and stays on the phone and in the Conversations tab; it comes back to the sidebar if its agent finishes, fails or needs you. | the tab's × |
| **Archive** | Out of every list on every device (the bridge stops a running turn first). Restorable; an open tab of it turns read-only with *Restore*. | sidebar row menu, chat header menu, Conversations tab |
| **Restore** | Back in the lists, on every device. | Conversations tab → *Filters → Archived only*, an archived tab |
| **Delete** | Gone for every device, with its history — after a confirmation that says so. A tab still showing it offers a new chat instead. | the same menus |
| **Fork** | A copy with the same agent: the history copied, and its first message carries a selection of it (the fork's agent session starts empty). | the same menus |
| **Continue with another agent…** | A new conversation with the agent you pick, carrying this one's context — see below. This one stays as it is. | the same menus, Conversations tab |
| **Session info** | Agent, model, folder, where it started, the conversation's id and the agent's own session id (to resume it in its own CLI). | the same menus |

One list of actions for every surface (`chatActionsFor`), one set of dialogs
for the window (`ChatActionDialogs`: rename, delete, continue with another
agent, session info).

### The Conversations tab

*See all conversations* on a new chat opens the **Conversations** tab (one per
machine; a view, so not restored after a restart). It lists every conversation
the bridge has — **This project** (the folder's project as the bridge resolves
it) or **All** (with the ones of removed projects under *No project*) — newest
first, grouped *Today / This week / Earlier*, each with its agent, project ·
branch, where it started and its state. **Search** filters titles at once and
asks the bridge for what was said (`thread/search`: the person's messages and
the agents' replies, never the steps); a content match shows its snippet with
the match marked, *Search older conversations* asks for the next page. A bridge
that predates the method gets a titles-only search. **Filters**: agent, state
(working, needs you, failed, idle), where it started (phone, desktop), archived
only. The selected conversation's details: agent and model, space, state, where
it started, what it continues and what continues it, its last exchange (one
`turn/list { limit: 1, fromEnd }`), and *Continue in chat*, *Continue in
terminal* (the same agent's session reopened through `agentResume.ts`; always
shown, and off with its reason under it when it cannot: Zero has no interactive
resume, a conversation with no message yet has no session, or a terminal
already holds it), *Continue with another agent…*, *Fork* and the rest of the
menu. Wide, list and details sit side by
side; narrow (≤ 44rem), the details replace the list until *Back*. Rules:
`src/lib/bridge/conversationsView.ts`.

### Continuing with another agent

No CLI continues another's native session, so a conversation never changes
agent: *Continue with another agent…* makes a **new** one (`thread/transfer`,
architecture/02a §5.8.21). Pick the agent and model, the context to carry —
**Selected context** (default: the opening request, the newest exchanges whole,
older ones shortened, the files changed, up to ~16k tokens), **Just a
reference** (title, opening request, last exchange) or **Full copy** (the whole
history copied for you to see; the agent gets the selected context) — and an
optional first message, sent whole after the context. The bridge builds the
context (no model writes it) and proves its delivery against the turn: the new
conversation's first line reads *Continued from …* with ≈ tokens and *goes with
the first message* / *being delivered* / *delivered* / *delivery unproven*
(sent again with the next message), and *Show context* shows exactly what the
agent read; the original shows *Continued with <agent> in …*.

**In a terminal**: the dialog asks for the first message (a brief is
prefilled), the bridge delivers the context with it in the chat, and once the
agent has answered its own session — which now holds the context — is reopened
in a terminal through the same path as *Open in terminal* (`agentResume.ts`).
Zero cannot reopen a session interactively, so it offers only a chat. Launching
the CLI with the context as its initial prompt was ruled out: up to 64 KB on a
command line breaks on Windows.

The state is the one every chat surface reads (`ThreadActivity`), the same five
a terminal agent shows: **working** while a turn runs, **waiting** while an
approval or a question waits on you, **blocked** when the last turn failed,
**done** when a turn finished and you have not looked yet, and idle. It comes
from the bridge's own stream — turns starting and ending, requests raised and
resolved — so a chat needs no hooks; right after connecting, `thread/list`'s
live `activeTurnId` says which conversations are already working. Chats count
toward the worktree's leading state, its "last moved" time, the needs-you
count and the sidebar's status order.

**What you have seen is remembered.** Opening a chat (or having it in view
when a turn ends) records the thread's `updatedAt` — the bridge's clock, never
this machine's — in the window's storage (`uxnan.chat.seen`), next to a
one-time `baseline`: the newest `updatedAt` there was the first time it ran,
so an upgrade does not flag the whole history. Every thread list the replica
adopts (at start-up, on reconnect, after a missed revision) converges on it:
a thread with nothing running that moved since it was seen asks the bridge
for its newest turn only (`turn/list` with `limit: 1, fromEnd: true`) and is
**done** again when that turn completed after the mark, **blocked** when it
failed; a rename or a stopped turn is not news, and the mark moves up instead.
The marks of threads that no longer exist are dropped with each list.

**Names.** A chat's title is its thread's, the same on every client: the bridge
names a new conversation from its first message and then asks the agent for a
real title; renaming the tab renames the thread (`thread/rename`), a rename on
the phone shows here, and a name given to a new chat's tab before its first
message becomes the thread's name (`thread/start { title }`).

## The chat's agent gets Uxnan's tools

While the desktop is connected, the agent of a chat gets the same MCP server the
agents launched in a terminal get — the browser, terminals, other agents, the
whole control catalog — scoped to the project the conversation's folder belongs
to (`docs/control-api.md` → *Callers*). The desktop hands the bridge its
endpoint and a token of its own for chat agents (`desktop/attach`, over the
local channel only; the token rotates on every start and the bridge forgets it
when the desktop disconnects). Settings → Browser's switch that gives the
agents Uxnan's tools (`mcpEnabled`) governs chats too. The bridge registers it
for **Claude Code**, **Codex**, **OpenCode**, **pi** (outside its read-only
posture) and **Grok** (when its CLI advertises HTTP MCP servers); **Zero** and
**Antigravity** only read a user-global config, so their chats run without it
for now (`bridge/docs/agents.md` → *Uxnan Desktop's tools*).

## A new chat

A new chat opens on one question — *What should we build in <folder>?* — over
the composer. Its toolbar carries the **agent and model** in one pill — its menu
has a rail of the agents' logos beside the chosen one's models (an agent not
installed stays there, dimmed; picking another agent's model picks that agent)
— the agent stays with the conversation, because another CLI cannot continue a
native session, and *Default model* lets the agent decide. Beside it, the
model's knobs and the **access mode** the conversation will start in, chosen
before the first message. The first message starts the thread in the tab's
folder — in that mode — and the thread is titled from that message until the
agent writes a better name.

Below it, kept short: **Recent here** — the three newest conversations of this
folder, whichever app started it — and **See all conversations (N)**, which
opens the Conversations tab on this project. **Continue from…** (or *Continue
from this in a new chat* in a recent one's menu) starts this chat as the
continuation of another: a line over the composer names it and the context to
carry, and the first message carries that context to the agent chosen here
(`thread/start { continueFrom }`). **Sessions in this folder** (three, *Show
all*) lists the agents' own sessions there that no conversation continues yet — ones
started in a terminal, here or elsewhere, or in the agent's own app
(`agent/sessions`, architecture/02a §5.8.19). Picking one continues it as
this chat: its history comes in and its first message resumes it. One that a
terminal of this window holds says *In a terminal*; picking it asks that
terminal to let it go first. An agent whose CLI cannot list its sessions
(Antigravity) is named under the list.

## From a terminal to a chat, and back

A terminal running an agent the bridge drives tells the bridge which session it
holds (`agent/hold`, and whether the agent is working). While it does,
the session has one writer — the terminal: a chat of it shows *This
conversation is open in a terminal on <PC>*, its composer waits, and the phone
shows the same. Only a tab whose shell runs holds: one restored from the saved
layout keeps its session but runs nothing until its workspace is shown, and
holds it again when its agent is back and reports it. On start the desktop also
lets go of any hold the bridge still keeps for it that no tab holds — the
bridge's connection outlives a reload of the window.

- **Continue as chat** (the terminal tab's menu, or the pane's): once the agent
  is not working, Uxnan closes it in that terminal — a signal to the agent's
  process (`pty_stop_agent`), never keystrokes; the shell and the tab stay —
  and opens the conversation that continues its session. The same happens on
  its own when the phone (or a chat) asks for the session with *Continue here*.
  An agent nothing runs any more (it exited, or its restored tab's shell has
  not started) offers it too; one that left its shell is closed as a no-op.
- **Open in terminal** (the chat's menu): the agent reopens the session in a new
  terminal, with its own profile (`app.launchAgent` with `resume`, the command
  `agentResume.ts` knows). Not while the agent is working, and not for Zero,
  whose terminal UI cannot resume a session.

The terminal side lives in `src/lib/state/terminalSessions.svelte.ts`; the
replica of every hold, in the chat store (`chat.holds`).

Agents offered are the bridge's (`agent/list`), not the desktop's agent
profiles: a chat runs on the bridge's drive surface for each CLI
(`bridge/docs/agents.md`), so availability is what the bridge resolves.

## In a chat

- **Header**: the conversation's name, its agent (fixed), and *Rename* (renames
  the thread, so the phone shows the same name) / *Archive*.
- **Timeline, while a turn runs**: everything in view, in the order the agent
  produced it — prose, and between it the steps it takes. A **subagent** the
  agent delegated to is its own card, as on the phone — what it was asked to
  do, still working or failed, and its report, which opens in place
  (`ChatSubagent.svelte`). Consecutive steps (commands, edits, tool calls) form
  one **work group**: a compact
  row per step (icon, verb, detail; while it runs its verb carries a soft
  sweep of light and the working spinner sits where the state goes, red when it
  failed), each one opening to its output or diff. A *Working for 12s* line —
  the same spinner and sweep — sits under the turn. The spinner is the app's
  one "working" mark, in the same hue as in the sidebar and on the project
  cards (`ChatWorkingGlyph`, `stateHue.working`). Both move on the compositor
  alone (`transform`), so a running agent costs the app no repaint per frame
  (`ShimmerText.svelte`, `ui/spinner`). When the agent
  compacts its context, one quiet *Context compacted* line between hairlines
  marks the spot; its tooltip (and screen-reader label) says why and by how
  much — the same words as on the phone, the token counts through the one
  `formatTokenCount` the context ring uses too.
- **A long conversation renders its newest turns.** The timeline starts with
  the newest six turns and brings older ones in as you scroll up (or press
  *Load earlier messages*) — first the ones already loaded, then older pages
  from the bridge — without moving what you are reading. While you read
  history the window holds still as new turns arrive; when the tab goes to the
  background with you at the end, it goes back to the newest turns, so a chat
  tab you are not looking at keeps only those in the page (one long
  conversation used to hold 56 000 elements, and hidden chats were nearly all
  of a workspace's page). Jumping to a message on the scroll rail brings it in
  first. A place you left in history (and saved across a restart) gets the
  whole loaded page, so it reopens exactly where it was
  (`src/lib/components/chat/chatWindow.ts`).
- **Timeline, once a turn settles**: the work that led to the answer — and,
  when the agent answered in several responses (Codex's commentary before its
  final answer), its earlier responses — folds behind one line — *Worked for 1m 3s* (or *Stopped after …* / *Failed after
  …*) — which opens back to it, each work group then closed to its summary
  (*Ran 3 commands · 2 edits*, and how many failed). The closing answer stays
  open — with any notice the bridge added after it (a background task cut
short) — followed by a card of the **files the turn changed** (+/− per file; a
  click opens the file). Scrolling to the top loads older
  turns.
- **The agent's reasoning sits where it happened**: each stretch of it is a
  thought among the steps of its work group (`{ type: 'thinking', text }`,
  built live from `stream/thinking/delta` by the bridge's own rule,
  `appendThinkingSegment`). Folded, a thought is one line — *Thinking* (with
  the working sweep and spinner) while it is the last thing the running turn
  did, *Thought* once anything follows it — and its own words, Markdown
  stripped, cut to the row's width. Open, it is Markdown in a box that scrolls
  past 16 rem; while it is being written the box follows the newest words,
  unless you scrolled up in it (scrolling back to its bottom follows again). A
  long thought's preview is its first 600 characters: *Show all of it* reads
  the rest (`turn/step`). The group's summary counts thoughts too (*Ran 12
  commands · 4 thoughts*).
- **A long conversation's work** is read when you open it (the bridge's
  bounded history, `architecture/02a` §5.8.8). A page brings each settled run
  of steps as one summary — its counts, how many failed, the files it changed
  and its last step — so a
  turn of hundreds of steps costs about what its prose does. Opening a work
  group reads its steps (`turn/steps`, in pages the bridge fits to 256 KiB)
  and draws 100 at a time, with *Show 100 more steps* for the rest (the next
  page is read when the drawn ones run out). A step is its preview: a
  command's first 400 characters and its output's last 1 200 — opening it
  shows that with an ellipsis where it was cut, and *Show the full output* (or
  *Show the full command*) reads the whole step (`turn/step`); an edit reads
  its diff when it opens, since no preview carries one. A live step arrives as a preview with its
  place in the turn (`index`): one that settles replaces itself, and a run the
  agent began before the chat was read (a page's summary) and goes on live is
  one group — its latest step in view, *Show N earlier steps* for the rest.
  What was read is kept while the conversation lives and goes with it
  (`chat.release`). A failure — an answer too large for the connection
  (`ResponseTooLarge`) included — says why, with *Retry*; nothing is asked
  again by itself (`ChatOnDemand.svelte`, `chatError.ts`).
- **Where you were**: coming back to a conversation read earlier in the session
  (another tab, another chat) opens it where you left it; one left at its end,
  or not read yet, opens at the end (`src/lib/bridge/readingPosition.ts`,
  in memory — a restart opens every conversation at its end, as on the phone).
  The place is settled whenever the timeline changes size
  (`src/lib/components/chat/chatScroll.ts`): a chat tab or workspace that is
  not on screen is hidden and has no height, so one that loaded there reaches
  its end — or its kept place — the moment it is shown, and a reply streaming
  in or an image loading late keeps a reader at the end there. Scrolling up
  stops following; scrolling back to the end, sending, or the jump-to-end
  button resumes it.
- **Messages**: a long message you sent folds to its first ten lines under a
  fade, with *Show more* / *Show less* (copying always takes the whole text).
  Hovering one shows when it was sent and a copy button (the copy writes each
  attachment as its `[name]`). The images and files sent with a message sit
  **inside its text, where they were written**, as the same chips the
  composer draws (`ChatSentAttachment.svelte`, cut by
  `src/lib/bridge/inlineMessage.ts`): resting on an image shows it whole and a
  click opens it; resting on a text file shows its first lines. The bridge
  keeps them with the message and hands each over with `turn/attachment`. A
  message stored before attachments had a place in the text shows them after
  its words.
- **Approvals and questions** wait in a dock **pinned above the composer**
  until they are answered. Several questions asked at once come one at a
  time (*1 of 3*, *Back* / *Next*, *Answer* on the last; a single choice moves
  on by itself), and **1–9** pick the options of the one on screen (never
  while a field has the focus); the timeline keeps a one-line record of each (what
  was asked, then how it ended). One answered on the phone (or timed out)
  settles here too; one from a turn that already ended never offers its buttons
  again.
- **Queue**: a message sent while the agent works always waits in the queue,
  and the composer says what happens next before it is sent — *it reaches it
  at its next pause* on an agent that takes input mid-turn, *it goes out when
  it finishes* on any other; the send button reads **Queue** and **Stop** stays
  next to it while a message is being written. Queued messages show **in
  place**, below everything and in the queue's order, as the outlined bubble
  (`chat.queuedBubble`) with their position (*Next in the queue*, *2 in the
  queue*) and three actions on every one, the first included: **Send now**,
  **Edit** (takes it off the queue and puts it back in the composer with its
  images and files — only once the bridge confirms — and leaves no cancelled
  bubble behind) and cancel. On an agent that takes input mid-turn the bridge
  hands the first one over when the step the agent is in ends — a long or hung
  command never locks it; only during that hand-over the bubble reads
  *Reaching the agent* (`queue.delivering`, from `deliveringTurnId`) with a
  spinner and no actions, and it drops into place when the agent reads it.
  **Send now** (`queue/sendNow`) forces it: while the agent works it reads
  *Stop the agent and send this now* — it stops the running turn and that
  message runs next, on every agent; with nothing running it just runs it
  next. A turn stopped with **Stop** pauses the queue: *Resume* or *Discard*,
  in the dock.
- **A message taken mid-answer**: the turn it interrupted (`Turn.continuedIn`)
  stays whole — its prose is the answer so far, not folded into *Worked for* —
  and ends with *Continues below, with your next message*; the message it
  continued in is marked *Reached the agent while it was working*.
- **Drafts and recall**: the composer's unsent text is the tab's draft, saved
  with the layout, so it survives switching tabs and restarting; its chips are
  kept with the tab in memory (`src/lib/bridge/composerAttachments.ts` — the
  bytes are too large for the layout), so they survive switching tabs and a
  new chat becoming a conversation, and a draft that comes back after a
  restart keeps its words without them. On an empty composer **↑** recalls the
  thread's earlier messages (newest first; an attachment as its `[name]`) and
  **↓** walks back.
- **Nothing written is lost.** Every message waits in the chat's outbox
  (`src/lib/bridge/outbox.ts`, this machine's storage) from the moment it is
  sent until the bridge has it. One that did not get there — refused,
  unreachable, or the app closed before an answer (*Not sent*) — stays as a
  failed bubble, across restarts, with **Retry** (sent again as written,
  attachments and model options included), **Edit** and *Dismiss*. A message
  whose attachments did not fit the storage comes back as its words alone
  (`withAttachments`), never with markers the bridge would refuse.
- **Saved drafts.** A message coming back into the composer (**Edit** on a
  queued or failed one) never merges with what is being written: that text is
  set aside, whole, in a *saved drafts* card in the dock, kept with the tab.
  Clicking one puts it back — setting aside whatever the composer holds then —
  and the bin throws it away. A failed or queued message brings its images
  and files back too, each at its place in the words (a queued one's are read
  back from the bridge, `turn/attachment`); a saved draft keeps its chips.
- **Composer**: Enter sends, Shift+Enter breaks the line; while the agent works
  the round button stops it; the paperclip attaches files. A narrow chat keeps
  the toolbar inside the composer: its pills shrink, then the effort and access
  pills drop to their icon, then the model pill to the agent's logo. Its toolbar holds
  what can change mid-chat — the model, behind the agent's logo (every client
  sees the change; models the CLI calls older fold under *Older models*), the model's knobs beside it when it has
  any — one picker for every agent (`RunOptionsPicker`): the brain mark the
  phone uses for effort and the level's name, a menu of the model's own levels
  (one per line) with the one it runs at by
  default marked (untouched, the bridge sends that default, so what the pill
  shows is what the turn uses; an agent that names no default offers
  "Default") — and the access mode — only the modes the conversation's agent offers, out of
  *Request approval* / *Approve for me* / *Full access* / *Plan only* (the menu
  is hidden for an agent with none; a new chat starts in the agent's default,
  set by the bridge; a mode the agent no longer offers is said above the
  composer, with the one it runs in; what each mode does per agent is in
  `bridge/docs/agents.md` → *Access modes*)
  — and a ring showing how full the context window is, when the agent reports
  it (amber past 75%, red past 90%; the figures are in its tooltip). For an
  agent with a plan the bridge reads (Claude Code, Codex, Grok) the tooltip
  adds that plan's most pressing window — its used share, when it resets and,
  when the pace so far hits the limit first, when (`usagePace.ts`) — and a dot
  on the ring marks that pace; the chat reads the plan
  (`usage.ensureProvider`) whether or not it is activated in Providers.
- **Commands, files and images** — what the phone's composer does, the same
  way. **`/`** at the start of a message lists the agent's commands in this
  folder (`agent/commands`, as the bridge learns them from the agent itself,
  loaded as soon as the agent is known), grouped as *Skills*, *Your commands*,
  *Agent commands* and *Built-in*; ↑ ↓ move, Enter or Tab completes, Esc
  closes, and a known `/name args` is sent as `turn/send { command }` — the
  bridge runs it natively or expands it — even when it was recalled, pasted or
  restored rather than typed, while an unknown `/word` goes as text. **`@`**
  asks the bridge that owns the conversation's folder, as the phone does: a
  bare `@` (or `@dir/`) lists that folder (`workspace/list`), a name searches
  the whole project (`workspace/searchFiles`, `.gitignore` honoured); a picked
  folder drills in and a picked file is inserted as its relative path.
  **Images and files** come from **+**, a paste or a drop onto the composer —
  from the system file manager (Finder, Explorer, the Linux one) or a row of
  the file tree — and each becomes a **chip inside the text, at the caret**,
  like a word of the sentence: *in this image ⟨a.png⟩ you can see X, and in
  this one ⟨b.png⟩ Y*. The message goes out exactly so — one
  `ATTACHMENT_MARKER` (U+FFFC) per chip in `turn/send { text }`, the
  attachments in the same order (`shared/src/models/inline-attachments.ts`) —
  and the bridge hands every agent the same interleaving
  (`bridge/docs/agents.md`). A chip is atomic: the caret steps over it,
  Backspace removes it whole, its ✕ takes it out (with the space that set it
  apart), copying a selection writes it as `[name]`, and pasted text arrives
  plain (never formatting, never a marker). Its label is the file name,
  shortened in the middle when long; an image shows a tiny thumbnail and
  resting on it shows the image whole; a file shows its type's glyph
  (`attachmentIcon.ts`). A pasted screenshot without a name of its own is
  `image-<n>.<ext>`, so two in one sentence are told apart. What each dropped
  item becomes:
  - an **image**, when the agent takes images — attached as an image;
  - a **file or folder of the conversation's project** — **mentioned**
    (`@path`, as if picked from `@`: the agent opens it itself);
  - a **folder from outside the project** (or the project's own folder) —
    written at the caret as its absolute path, quoted when it has spaces, the
    same text a terminal gets (`fs_is_dir` tells a folder from a file);
  - **any other file** — attached like **+** does.

  Each item stands on its own: one that cannot be attached (larger than the
  20 MB limit, gone) is named in a toast and every other item of the same drop
  is still taken. Drops go through one router, `src/lib/fileDrop.ts`: Tauri's
  native drag-drop owns the OS gesture (HTML5 file drops never reach the
  WebView), so the router hit-tests where the files land — the composer, a
  terminal pane (the path is typed at its cursor), or, for an OS drop anywhere
  else, the active terminal. The drop's position is hit-tested in CSS pixels
  (`dropPointToCss`): the webview reports it in CSS pixels on macOS and Linux
  and in physical pixels only on Windows, so it is scaled down there alone —
  dividing everywhere put the point at half its place on a Retina Mac, and a
  drop on the composer fell through to the terminal.

  The `/` and `@` panel opens above the composer while it fits and below it when a new chat's mid-pane composer has more room there,
  never taller than the room it has (`src/lib/floatingFit.ts`).
- **The scroll rail** — the phone's, for a mouse. A faint mark per message the
  user sent sits on the conversation's right edge (`ChatScrollRail.svelte`,
  anchors from `src/lib/bridge/railAnchors.ts`); the message on screen has a
  longer mark. Pointing at the strip grows the nearest mark and its two
  neighbours and shows that message with the last paragraph of its reply; a
  click, or ↑ ↓ then Enter once it has the focus, scrolls to it. It needs at
  least two messages.
  Images are scaled to 2048 px on the long edge (JPEG 85 % when larger, as on
  the phone), up to 10 per message (the phone's limit — past it a toast says
  so), and go as images only to an agent that takes them
  (`capabilities.images`). Anything else — and an image for an agent that takes
  none — goes as a **file** (`type: 'file'` with its name, up to 20 MB and 10
  per message; `fs_read_attachment` reads a picked one): the bridge writes it
  under its name in the agent's folder, so every agent opens it with its own
  tools.

## For developers

- Stores: `src/lib/bridge/client.svelte.ts` (connection + call + notification
  fan-out), `chat.svelte.ts` (thread list, actions), `conversation.svelte.ts`
  (one thread's timeline reducer, including `openRequests` for the dock; its
  turns are `$state.raw` — a turn is replaced, never mutated, which read a
  30-turn page of 400-step turns in 0.5 ms against 38 ms through deep
  proxies — and it places a live block by its stored `index` (`placeBlock`)
  and keeps what the timeline read on demand: `stepRun` / `loadSteps`,
  `fullStep` / `loadFullStep`),
  `timeline.ts` (pure: grouping a turn's parts — steps and the `work` runs a
  page summarizes — into work groups, splitting the closing answer, work
  summaries, changed files, durations; a step's failed/running state is the
  shared rule, `stepFailed` / `stepRunning` in `shared/src/models/history.ts`) and
  `streamingMarkdown.ts` (the phone's streaming split and render window).
- **One store and one replica per machine with a bridge.** `bridge` / `chat` are
  this machine's; a connected host whose account runs its own bridge gets its
  own `BridgeClientStore` (`bridges.for("ssh:<id>")`, fed by the
  `bridge:host-status` / `bridge:host-notification` events) and its own
  `ChatStore` (`chatFor(target)`), with seen marks and outbox kept apart
  (`hostSeenStore`, `outboxKey`). A chat tab carries the `target` its thread
  lives on, and its pane provides that machine's replica to every chat
  component below it (`provideChat` / `useChat`); outside a pane, actions find
  the replica by thread (`chatOfThread`). Reads from derived values use
  `chatStatusesAt(target, path)` / `chatStatusOf(target, threadId)`, which
  never create a replica. The chat UI does not offer host projects yet
  (`02g` §5.18).
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
