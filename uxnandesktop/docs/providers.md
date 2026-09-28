# Provider usage statistics

Settings → **Providers** answers two questions:

- **What did my agents spend?** — every model response the agents on this PC
  recorded, per day, per agent and per model, in cost or in tokens.
- **How much of my plan is left?** — each activated provider's quota windows
  (percent **used**, reset countdown **and** the absolute reset time), plan and
  **account type**, any credit / $ balance, and Codex's redeemable rate-limit
  **resets**.

Both come from the **bridge** — the one reader every client asks (architecture
`02a` §5.8.10): the phone sees exactly what the desktop sees, and the desktop
reads no credential and asks the OS for nothing. With the bridge stopped the
panel says so and offers to open the Bridge window.

## What your agents spent

`usage/summary` reads the history each agent CLI keeps on disk itself — the
sessions the bridge runs **and** the ones you run in a terminal — and counts
each model response once. Supported: Claude Code, Codex, pi, Grok and
OpenCode 2 (the formats and where each lives are in
`bridge/src/usage/transcript-usage.ts`). The bridge keeps an incremental cache
(`~/.uxnan/usage-scan.json`), so after the first read only what was appended
is read again.

The panel (`src/lib/components/ProviderSpend.svelte`, view data from
`src/lib/usageSpend.ts`):

- **Period** 7 / 30 / 90 days and **measure** cost / tokens.
- **The headline** — the period's total, with sessions, responses and tokens
  (or the share read from cache).
- **A column per day, stacked by agent.** Each agent keeps its colour on every
  surface and in every period (the colour belongs to the agent, never to its
  rank). Hover a day for its figures. A column is one shape with a rounded top,
  however many agents it holds; every agent's segment is at least 2 px with a
  2 px gap to the next, so a small share never vanishes — what it gains comes
  from the largest segments, and only a column too short for its agents grows
  (`src/lib/spendColumn.ts`; the phone lays its chart out by the same rule).
- **The legend is the agent list**: share and total per agent. Click an agent
  to **focus** it — the chart rescales to it and the headline and the models
  table follow; click again for every agent.
- **Models** — the top twelve models by the chosen measure.

Cost is what the provider billed where the CLI records it (pi, Grok, OpenCode;
a free model counts $0). Otherwise it is an **estimate at the provider's public
API prices** (Claude Code) and the headline says so — a subscription plan pays
a flat fee instead. A model with no known price is never shown as $0: it reads
**No price**, is counted in tokens, and focusing such an agent charts it in
tokens.

## Plan limits

| Provider | How the bridge gets them | Reads |
|---|---|---|
| **Claude Code** | asks `claude` itself (stream-json control requests `initialize` + `get_usage`) — no Keychain, no file | session (5h) / weekly / model-scoped windows, plan, account type, email + organization |
| **Codex** | asks `codex app-server` itself (`account/read` + `account/rateLimits/read`) | monthly/weekly windows, plan, credit, **rate-limit resets**, account type, email |
| **GitHub Copilot** | `gh auth token` → GitHub's usage API | premium/chat/completions quotas, plan, account type, GitHub login |
| **Grok** | `~/.grok/auth.json` → Grok's usage API | credit-usage window, reset, **on-demand / prepaid $**, plan, account type, email |

Asking Claude Code and Codex means each answers for the account it is signed in
to, from wherever it keeps its sign-in (the macOS Keychain, the OS keyring, a
file): the old macOS **Access required** / **Grant access** step and its
per-update re-grant are gone, and Codex in `keyring` mode works like any other.
No turn runs and no token is spent; each probe is a short-lived process.

A provider that isn't set up, isn't signed in, or errors shows a clear status
(`Not set up` / `Sign in required` / `Unavailable`) instead of failing the rest —
each provider is read independently.

**A live provider can still have no meter.** Quota windows are percentages of an
allowance, so an account billed by spend has none to report — a pay-as-you-go
Grok account returns no `creditUsagePercent`. That is not a failure: the
provider reads `Live`, and the status-bar section says the account reports no
window rather than telling you to sign in again.

### Using it

1. Open **Settings → Providers**.
2. In *Your providers*, pick one from **Add a provider** (it flags which agents
   the bridge found on this PC).
3. Each activated provider gets a **tab**:
   - **Quota windows** — a bar per window: the percent consumed, the reset
     countdown and the absolute reset time ("resets in 2h · 3:00 PM").
   - **Rate-limit resets** — for Codex, how many you have and when each expires,
     with **Redeem** (behind a confirmation). The bridge redeems it by asking
     Codex (`usage/redeemReset`) with a key per attempt, so a retry after a lost
     answer never spends a second one.
   - **Credit** — a balance / $ figure when the provider exposes one.
   - **Account** — "Authenticated as …" with an **account-type** badge; the
     email/login is blurred until clicked.
   - **Refresh interval** — per-provider override of the global interval.
   - **Status bar** — which windows / plan / credit / reset time / resets
     surface in the bottom status-bar popover.
4. The section header carries the **global refresh interval** and a master
   **status-bar indicator** toggle.

The bottom status bar shows a **gauge** button whose popover lists the meters
you pinned; it tints amber/red as usage nears a limit, and is hidden when
nothing is pinned. Opening the popover leaves focus where the pointer is;
closing it does not restore focus to the gauge, so its tooltip only appears
when the control is actually hovered or keyboard-focused.

## How it's wired

`src/lib/state/usage.svelte.ts` is the one store: `agent/usageStats` for the
activated providers (an initial read, a catch-up of stale snapshots when the
app regains focus, one timer per provider — a provider's override wins over the
global interval, `0` disables only its repeating timer, and the resource-mode
policy may lengthen a cadence), `usage/summary` for the spend, and
`usage/redeemReset`. The app has no Rust usage reader and no credential code.

Settings persisted in `AppSettings` (`src/lib/types.ts` ↔ `src-tauri/src/model.rs`):
`usageProviders` (the activated list + each one's refresh override and
status-bar picks), `usageRefreshMinutes` (global, default 5; `0` = manual), and
`usageStatusBarEnabled`.

## Verify

- `npm run check` + `npm test` — `usageSpend.test.ts` (the period series, shares,
  scale, formatting), `ProviderSpend.svelte.test.ts` (bridge-off state,
  unpriced agents, focus, measure), `usageFormat.test.ts`,
  `usageSchedule.test.ts` and `ProviderUsageEditor.svelte.test.ts` (redeem
  through the bridge).
- The bridge side: `npm test -w bridge` (`test/usage/`).
- By hand, against a running bridge: open Settings → Providers; the spend panel
  shows this PC's history; add Claude Code on a Mac — *Live*, with no dialog.
