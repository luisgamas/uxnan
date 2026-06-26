# Multi-agent orchestration

Run several CLI agents at once and **drive them from one place**: send a message
to every agent, to all agents of one type, or to a coordinator's workers — and
let the ADE deliver it to each one **only when it's free** (backpressure), so a
slow agent is never flooded.

This is the implementation of `architecture/02d-agent-monitoring.md` §3.

> **TL;DR.**
> 1. Launch **2 or more agents** (any worktrees — see
>    [agent launch](./agent-launch.md)).
> 2. A **workflow icon + agent count** appears in the **status bar** (bottom
>    right). Click it.
> 3. Type a message, pick a **target** (All / a type / the coordinator's
>    workers), and **Send** (or `Ctrl+Enter`).
> 4. Each agent gets the message typed into its terminal; if it's busy, the
>    message waits in that agent's queue until it reports idle.

---

## When would I use this?

Whenever you have more than one agent working in parallel and want to coordinate
them without clicking into each terminal:

- **Broadcast a context update** to every agent ("the API base URL changed to
  …").
- **Fan a task out to one type** — e.g. tell *every* `claude` to run its test
  suite, or *every* `codex` to rebase.
- **Coordinator pattern** — keep one agent as the "lead" and push instructions to
  its workers, one at a time, as each frees up.

Each "agent" is simply a terminal tab running an agent CLI (identified by the
command you launched it with, e.g. `claude`, `codex`). Delivery is the ADE typing
your message into that terminal and pressing Enter — exactly what you'd do by
hand, just routed and backpressured.

---

## Where it is / how to open it

The orchestration entry point lives in the **status bar** (the thin bar at the
bottom of the window):

- It appears **only when ≥ 2 agents are running** (routing/fan-out needs more
  than one agent). With zero or one agent it stays hidden.
- It shows a **workflow icon** followed by the **number of live agents**, and a
  small **primary-colored dot** when there are messages still queued.
- **Click it** to open the orchestration console (a modal). You can also reach it
  any time the icon is visible; closing the console does **not** stop in-flight
  delivery — queued messages keep draining in the background.

---

## The console

The console has two parts: the **agent list** (top) and the **composer**
(bottom).

### Agent list

Agents are grouped by **type** (their command — `claude`, `codex`, …). Each row
shows:

| Element | Meaning |
|---|---|
| **Status dot** | The agent's state — precise (`working` / `blocked` / `waiting` / `done`) if it reports [hooks](./agent-hooks.md), else coarse `working` / `idle` inferred from output. |
| **Logo + name** | The agent and the worktree/branch it runs in. |
| **`N queued` badge** | How many messages are waiting in this agent's backpressure queue (not counting one already delivered). |
| **Crown** | Mark this agent as the **coordinator** (click again to unset). Highlights the row and unlocks the "workers" target. |
| **Eraser** | Drop this agent's queued (undelivered) messages. Only shown when it has a queue. |
| **↗ (go to terminal)** | Jump to that agent's terminal and close the console. |

### Composer

- **Message box** — what to send. Single-line prompts work best (see
  [caveats](#caveats)); `Ctrl/⌘+Enter` sends.
- **Target selector** — who receives it (below).
- **Send button** — shows the resolved recipient count, e.g. *Send to 3*. It's
  disabled when the message is empty or the target currently matches no agent.

---

## Routing targets

| Target | Who gets the message |
|---|---|
| **All agents** | Every live agent, of any type (fan-out). |
| **All `<type>`** | Every live agent of that type — e.g. *All Claude Code* hits every running `claude` (fan-out by type). One option appears per type currently running. |
| **Coordinator's workers** | Every live agent **except** the coordinator. Only shown once you've set a coordinator (crown). |

A single send enqueues **one copy per matched agent**, so a fan-out to five
agents queues five messages (one each), each delivered independently under
backpressure.

---

## Coordinator & workers (the task graph)

The ADE keeps an **in-memory** coordinator → workers relationship (it is **not**
saved; it resets when you close the app):

- Click the **crown** on any agent to make it the **coordinator**.
- Its **workers** are every other live agent. The **Coordinator's workers**
  target fans out to all of them — handy for a "lead drives the team" pattern.
- Click the crown again (or on another agent) to unset/move it.

> The original design imagined a coordinator that *creates* worker worktrees on
> its own. That needs an agent→ADE control channel that doesn't exist yet (agents
> are opaque CLIs), so today **you** create the worktrees/agents and just
> *designate* the coordinator. The relationship is shown in this console rather
> than nested in the left sidebar — see the spec note in
> `architecture/02d-agent-monitoring.md` §3.4.

---

## Backpressure (how delivery is paced)

The whole point is to **not overwhelm an agent**. For each agent the ADE keeps a
**FIFO queue** and delivers messages one at a time:

1. You send → a copy is queued for every matched agent.
2. The ADE delivers the **head** of a queue **only when that agent is free**.
3. After delivering, it waits for the agent to go busy (it picked the work up)
   **before** considering that agent's next message.
4. When the agent reports free again, the next message goes — and so on until the
   queue empties.

"Free" is judged from the agent's state:

- **With [hooks](./agent-hooks.md) installed** — precise: `working` and `blocked`
  count as busy; `waiting` / `done` / idle count as free. This is the most
  reliable backpressure.
- **Without hooks** — coarse: the ADE infers busy/idle from terminal **output
  activity**. It's approximate but works for most agents. As a safety net, if an
  agent never reports busy after a delivery, a short grace window releases its
  next message so the queue still drains.

> **Tip:** install hooks for the agents you orchestrate ([guide](./agent-hooks.md))
> — precise states make backpressure exact instead of best-effort.

You can watch this live: send several messages to one busy agent and its
`N queued` badge counts down as it works through them.

---

## Caveats

- **Single-line prompts.** A message is typed into the terminal followed by
  Enter. Most agent prompts submit on Enter, so embedded newlines may submit
  early — keep each message to one line for predictable results.
- **The agent must be at its input prompt.** Delivery types into the terminal; if
  the agent is mid-question or showing a menu, the text lands wherever the cursor
  is. Backpressure waits for *idle*, which usually means "back at the prompt", but
  agents without hooks can be misjudged — prefer hooks for tight loops.
- **Exited agents are skipped.** A delivery to a terminal whose agent has exited
  is silently dropped (the queue entry is consumed).
- **Nothing is persisted.** Queues and the coordinator are in-memory; closing the
  app clears them.

---

## See also

- [Agent launch & configuration](./agent-launch.md) — register agents, per-agent
  env vars, the launch shell, auto-launch on worktree create.
- [Agent hooks — precise states](./agent-hooks.md) — make backpressure exact.
- Spec: [`architecture/02d-agent-monitoring.md`](../architecture/02d-agent-monitoring.md)
  §3 (orchestration), §1 (monitoring layers that feed idle detection).
