# Multi-agent orchestration

![Surfaces](https://img.shields.io/badge/surfaces-broadcast_%2B_run_engine-2ea44f?style=for-the-badge)
![Passing](https://img.shields.io/badge/context-A%E2%86%92B%E2%86%92C-blue?style=for-the-badge)
![Verified](https://img.shields.io/badge/headless-verified_by_exit_code-8957e5?style=for-the-badge)

Run several CLI agents at once and **drive them from one place**. The orchestration
console (spec `architecture/02d-agent-monitoring.md` §3) has **two tabs**:

- **Broadcast** — the fan-out router: send a message to every agent, to all agents
  of one type, or to a coordinator's workers, delivered under **backpressure** (one
  at a time per agent). Fire-and-forget; nothing is chained or persisted.
- **Runs** — the **run engine**: build a **run** (a small graph of **steps**) where
  one step's output can feed the next (`{{steps.s1.output}}`), independent steps run
  **in parallel**, a step can pause for **your approval** (a gate), and the whole run
  is **durable** — it survives a restart and the engine re-attaches on load.

> **TL;DR — Broadcast.** Launch **2+ agents** → a **workflow icon + count** appears
> in the **status bar** (bottom right) → click it → **Broadcast** tab → type a
> message, pick a target (All / a type / workers), **Send** (`Ctrl+Enter`).
>
> **TL;DR — Runs.** Open the console → **Runs** tab → **New run** → **Add step**
> (pick a type + agent + prompt, and which steps it *runs after*) → repeat →
> **Start**. Watch each step light up, and expand a step to read its captured output.

---

## Where it is / how to open it

The entry point lives in the **status bar** (the thin bar at the bottom):

- It shows a **workflow icon** + the **number of live agents**, with a small dot when
  broadcast messages are still queued.
- It appears when **≥ 2 agents are running** *or* whenever **any run exists** (so a
  saved run stays reachable to build, drive or review even with fewer agents).
- **Click it** to open the console (a modal). Closing the console does **not** stop
  anything — queued broadcast messages keep draining and active runs keep advancing
  in the background while the app is open.

---

# Part 1 — Broadcast (fan-out router)

The original "difusión" surface. Use it to push the same instruction to many agents
without clicking into each terminal.

## The agent list

Agents are grouped by **type** (their command — `claude`, `codex`, …). Each row shows:

| Element | Meaning |
|---|---|
| **Status dot** | Precise hook state (`working` / `blocked` / `waiting` / `done`) if the agent reports [hooks](./agent-hooks.md), else coarse `working` / `idle` from output. |
| **Logo + name** | The agent and the worktree/branch it runs in. |
| **`N queued`** | Messages waiting in this agent's backpressure queue. |
| **Crown** | Mark this agent the **coordinator** (unlocks the "workers" target). |
| **Eraser** | Drop this agent's queued (undelivered) messages. |
| **↗** | Jump to that agent's terminal. |

## Routing targets

| Target | Who gets the message |
|---|---|
| **All agents** | Every live agent (fan-out). |
| **All `<type>`** | Every live agent of that type (fan-out by type). |
| **Coordinator's workers** | Every live agent except the coordinator (needs a crown set). |

A single send enqueues **one copy per matched agent**. Delivery is **backpressured**:
the ADE delivers the head of each agent's FIFO queue **only when that agent is free**,
then waits for it to go busy before considering its next message — so a slow agent is
never flooded. With hooks installed this is precise; without, it's inferred from
output activity (with a short grace window so the queue still drains).

The coordinator → workers link is **in-memory** (it resets when you close the app);
it's a designation, not automation.

---

# Part 2 — Runs (the run engine)

A **run** is a graph (DAG) of **steps**. Each step targets an agent, has a prompt, and
declares which steps it **runs after**. The engine promotes ready steps (dependencies
met), dispatches them (respecting a concurrency cap), captures each step's output onto
the run's shared "blackboard", and detects completion — then opens the next steps.

## Step types

| Type | What it does | Output it captures | Completion signal |
|---|---|---|---|
| **Interactive** | Types the prompt into a **live agent's terminal** (like Broadcast). | The agent's coarse hook **summary** (or a structured result if the agent reports one via MCP — see below). | The hook `done`/idle signal (best-effort without hooks). |
| **Headless** | Runs an **installed CLI in print-mode** (`agent -p …`) in a chosen worktree. The ADE owns the process. | The agent's **full stdout**. | The **process exit code** — `0` = done, non-zero = failed. **Verified**, not cooperative. |
| **Human gate** | Pauses the run for **your** decision. | Your optional **note**. | You click **Approve** or **Reject**. |

> **Interactive vs Headless — which to use?** Interactive keeps a human-visible agent
> in the loop and reuses an agent you already launched, but its captured output is only
> the short hook summary. Headless is for robust **chaining**: it captures the complete
> answer and verifies completion by exit code, at the cost of spawning a fresh one-shot
> process (no live conversation). Prefer **headless** when a later step needs the
> previous step's full output.

## Passing context between steps (A → B → C)

Every completed step stores its `output` (and a short `summary`) on the run. A later
step's prompt can plant them with a template reference:

- `{{steps.s1.output}}` → step `s1`'s captured output
- `{{steps.s1.summary}}` → its short summary
- `{{steps.s1.title}}` → its title

In the step editor, the **Insert output** chips add these for you (and automatically
make the step *run after* the one it references). Step ids are short and stable
(`s1`, `s2`, …), so a reference never breaks when you reorder steps.

## Dependencies, parallelism & fan-in

Each step's **Runs after** toggles are the DAG edges:

- **Sequence** — `s2` runs after `s1`, `s3` after `s2` (a new step defaults to running
  after the previous one).
- **Parallel** — give two steps **no** dependency and they dispatch at the same time
  (up to the concurrency cap of 4).
- **Fan-in** — a step that runs after **both** `A` and `B` opens only when *both*
  complete. That's the classic "A and B in parallel, then C".

If any step a dependent needs **fails** or is **skipped**, the dependent is **skipped**
(it can never run). Cycles are rejected when you Start.

## Human gates (approval before a stage)

A **Human gate** step pauses the run and shows its question inline with **Approve** /
**Reject** buttons and an optional note. A **native notification** fires so you're
alerted even if you're elsewhere. Approving completes the gate (your note becomes its
output, so later steps can quote `{{steps.g1.output}}`); rejecting fails it (its
dependents skip). Independent branches that don't depend on the gate keep running.

## Auto-repair (retry)

Each agent step has an **On failure** policy:

- **Stop the run** (default) — a failure fails the run.
- **Retry the step** — on failure the step is re-dispatched, up to **Max attempts**
  (2–9). An interactive retry may re-bind to another live agent of the same type; a
  headless retry re-spawns the process.

## Durability & restart

The run graph, step states **and captured outputs** are persisted (as an opaque blob,
via `set_orchestration_runs`, the same way the terminal layout is). On the next launch
the engine **re-attaches**: completed outputs are kept (the context chain survives),
and any step left mid-flight drops back to *ready* so it re-dispatches. The run
advances **while the app is open**; a background engine is a future hardening step.

## Structured reports over MCP (interactive steps)

The ADE injects an **orchestration MCP tool** into each agent it launches (alongside
the browser tools — see [browser](./browser.md)): `orchestration_report_result`. When
an interactive step's agent calls it (passing its `UXNAN_AGENT_ID`), the run captures
that **structured result verbatim** as the step's output — better than the coarse hook
summary — and completes the step immediately. There's also `orchestration_report_progress`
for a live one-line status. This is *cooperation when it helps*; the hook/idle signal
remains the fallback when the agent doesn't report. (Requires the browser MCP injection
to be on — Settings → Browser.)

---

## How to test it (end-to-end)

Run the app in dev (`npm run tauri dev` — see [development](./development.md)). The
scenarios below map to Stages E1–E3 of the plan.

### E1 — interactive chain + persistence

1. Add a project and launch **two agents** into worktrees (see [agent launch](./agent-launch.md)).
   Install [hooks](./agent-hooks.md) for tighter completion detection.
2. Open the console → **Runs** → **New run** → **Add step**:
   - Step 1 (**Interactive**, agent A): prompt *"Summarize the README in 3 bullets."*
   - Step 2 (**Interactive**, agent B): click the **Insert output** chip for step 1,
     then *"Turn these into a checklist:"* — it now *runs after* step 1.
3. **Start**. Watch step 1 go **Running → Done**, then step 2 dispatch with step 1's
   summary planted in its prompt (visible in agent B's terminal).
4. **Persistence:** while the run is active (or after it finishes), quit and relaunch
   the app. Reopen the console → the run is still listed with its captured outputs;
   a mid-flight step is back at *Ready*.

### E2 — headless chain + verified completion

1. Add a step of type **Headless**, pick an installed CLI, a model, and a **worktree**.
   Prompt: *"List the top 3 files by size in this repo."*
2. Add a second **Headless** step that references `{{steps.s1.output}}`.
3. **Start**. Step 1 captures the CLI's **full stdout**; step 2 receives it verbatim.
4. **Failure:** make a headless step fail (e.g. an unsupported model id) and confirm it
   goes **Failed** with the CLI's stderr shown, and (if *On failure = Retry*) that it
   re-attempts up to Max attempts.

### E3 — gate + parallel fan-in

1. Build: step A and step B with **no dependency** (they run in parallel), a **Human
   gate** that runs after both, and a final step that runs after the gate.
2. **Start**. A and B dispatch together; when both finish, the gate appears with
   **Approve / Reject** (and a native notification fires).
3. **Approve** → the final step runs, with the gate's note available as
   `{{steps.<gate>.output}}`. Re-run and **Reject** → the final step is **skipped**.

### Automated checks

- **Frontend:** `npm test` — the pure engine logic (`src/lib/orchestration/run.ts`) is
  unit-tested in `run.test.ts` (DAG readiness, template substitution, cycle detection,
  validation, status derivation).
- **Backend:** the headless runner (`src-tauri/src/agentrun.rs`) and the persistence
  field are unit-tested; run `cargo test` in `src-tauri/`.
- **Types/lint:** `npm run check` (svelte-check) and `cargo clippy` / `cargo fmt`.

---

## Caveats

- **Interactive output is thin.** Without a structured MCP report, an interactive
  step's output is only the agent's short hook summary. For full context, use a
  **headless** step or have the agent call `orchestration_report_result`.
- **Interactive completion is best-effort without hooks.** The engine watches the
  target agent go busy then idle; a hook-less agent it never catches busy completes
  after a short grace window. Install [hooks](./agent-hooks.md) for tight loops.
- **Cancelling doesn't stop a subprocess/agent already working.** The engine lets go
  (marks remaining steps skipped), but an already-typed interactive agent or an
  in-flight headless process keeps running to completion.
- **Large context via a CLI argument.** A headless prompt is passed as an argument and
  capped (~28 KB) to stay within the OS command-line limit; very large chained context
  is clipped. (Streaming large prompts via stdin is a tracked follow-up.)
- **Headless in a WSL worktree** runs the Windows-side CLI against the `\\wsl$` share
  (functional but slow); native in-distro headless routing is a tracked follow-up.

---

## See also

- [Agent launch & configuration](./agent-launch.md) — register agents, per-agent env,
  the launch shell, auto-launch on worktree create.
- [Agent hooks — precise states](./agent-hooks.md) — make interactive completion exact.
- [Browser](./browser.md) — the injected MCP channel the orchestration tools ride on.
- Spec: [`architecture/02d-agent-monitoring.md`](../architecture/02d-agent-monitoring.md) §3.
