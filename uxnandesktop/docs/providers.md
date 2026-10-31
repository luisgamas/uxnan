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
each model response once. Supported: Claude Code, Codex, pi, Grok, OpenCode 2,
Zero and Antigravity (the formats and where each lives are in
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

Every provider is **asked of its own CLI**, which answers for the account it
is signed in to — so neither the bridge nor this app reads a credential, and
nothing asks the OS for permission. The bridge's live matrix and the exact
requests are in `bridge/docs/agents.md` → *Plan limits*.

| Provider | How the bridge gets them | Reads |
|---|---|---|
| **Claude Code** | asks `claude` itself (stream-json control requests `initialize` + `get_usage`) | session (5h) / weekly / model-scoped windows, plan, account type, email + organization, usage credits once enabled |
| **Codex** | asks `codex app-server` itself (`account/read` + `account/rateLimits/read`) | monthly/weekly windows, a seat's spend limit, plan, credit, **rate-limit resets**, account type, email |
| **GitHub Copilot** | asks GitHub's CLI: `gh api /copilot_internal/user` (`gh` sends its own sign-in) | chat/completions/premium quotas the plan includes, plan (`Copilot Free`, …), account type, GitHub login |
| **Grok** | asks `grok agent stdio` (`_x.ai/billing`) | the period window (weekly on a free account) + reset, **on-demand $ spent of its cap, or the prepaid $ balance** (once the account has either), plan, account type |
| **Antigravity** | asks `agy -p /usage` and `agy -p /credits` (agy 1.1.11+, no agent turn) | one weekly window per model group (Gemini; Claude and GPT) + reset, AI credits once above 0 |
| **OpenCode** | asks OpenCode 2's own server (`opencode api --standalone GET /api/experimental/usage/limits`) | OpenCode Go session/weekly/monthly meters, the OpenCode Console budget ($ spent of its limit), workspace |

pi and Zero are not listed: they run on your own provider keys and report no
plan limits (what they spent is in the panel above).

**Banked resets.** Codex's rate-limit resets are listed and used from here or
the status-bar popover — **Use…** opens a confirmation, and only its confirm
button redeems the soonest-expiring one (`RedeemResetDialog.svelte`).
Claude Code's limit resets are listed too, with how to use them: Claude Code
spends one only through its own `/limit-reset`, so there is no button. No other
provider exposes resets.

A provider that isn't set up, isn't signed in, or errors shows a clear status
(`Not set up` / `Sign in required` / `Unavailable`) instead of failing the rest —
each provider is read independently.

**A live provider can still have no meter.** Quota windows are percentages of an
allowance, so an account with no allowance has none to report — an OpenCode
Console workspace with no Go plan, a pay-as-you-go account (which shows its $
instead). That is not a failure: the provider reads `Live`, and the popover says
the account has no quota to meter rather than telling you to sign in again.

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
   - **Balances** — each $ or credit balance the provider reports (Claude's
     usage credits, Grok on-demand and prepaid, Antigravity AI credits, every
     OpenCode Console budget), named in the UI language.
   - **Plan** — beside the status, said once: the plan's name, or the account
     type when the provider names no plan.
   - **Account** — "Authenticated as …"; the email/login is blurred until
     clicked.
   - **Refresh interval** — per-provider override of the global interval.
   - **Status bar** — whether the provider is in the bottom status-bar popover
     and which of its windows; its plan, each window's reset, its money and
     its resets come with it.
4. The section header carries the **global refresh interval** and a master
   **status-bar indicator** toggle.

The bottom status bar shows a **gauge** button whose popover lists every
provider you pinned — all six can be — one block each: name and plan, one line
per pinned window (name · bar · % used · "in 3d 6h", the absolute reset time on
hover), then each of its balances and its resets when it has any; a provider that is not
signed in or failed says so in its own block. The popover is 30rem wide (never
wider than the window) and scrolls past the window's height. The gauge tints
amber/red as usage nears a limit, and is hidden when nothing is pinned. Opening the popover leaves focus where the pointer is;
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
  `usageSchedule.test.ts`, `usageCatalog.test.ts`,
  `ProviderUsageEditor.svelte.test.ts` (redeem through the bridge, the CLI each
  provider is asked through), `UsageMeter.svelte.test.ts` (card and row) and
  `UsageStatusButton.svelte.test.ts` (plan, money, resets, a failed provider)
  and `usageLabels.svelte.test.ts` (window and balance names per language,
  credits singular/plural).
- The bridge side: `npm test -w bridge` (`test/usage/`).
- By hand, against a running bridge: open Settings → Providers; the spend panel
  shows this PC's history; add Claude Code on a Mac — *Live*, with no dialog.

## Names in the UI language

The bridge sends stable ids, not words: each window an `id` (and a `model` for
a model-scoped one), each balance a `period` from a fixed vocabulary, with the
English text as a fallback. `src/lib/usageLabels.ts` is the one place the app
turns them into words (`windowLabel`, `balanceLabel`, `formatBalanceFigure`,
`formatAmount`); an id it does not know shows the bridge's English label. The
phone's `usage_format.dart` follows the same table.
