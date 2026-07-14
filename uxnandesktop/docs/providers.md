# Provider usage statistics

Settings → **Providers** shows how much of each AI provider's quota you've
consumed — quota/rate windows (percent **used** + reset countdown **and the
absolute reset time**), your plan and **account type**, any credit / $ balance, and
Codex's redeemable rate-limit **resets** — for the providers you activate. Only
activated providers are ever read, so an idle feature costs nothing.

## Supported providers

Usage is read from each CLI's **own signed-in token**, calling the provider's
**official usage API**. Posture: never browser cookies, never API keys you paste
into Uxnan — only the token the CLI already stored on disk.

| Provider | Source file | Reads |
|---|---|---|
| **Codex** | `~/.codex/auth.json` | monthly/weekly windows, plan, credit, **rate-limit resets**, account type, email |
| **Claude Code** | `~/.claude/.credentials.json` | session (5h) / weekly / model-scoped windows, plan, account type |
| **GitHub Copilot** | `gh auth token` | premium/chat/completions quotas, plan, account type, GitHub login |
| **Gemini CLI** | `~/.gemini/oauth_creds.json` | per-model quota (best-effort), email |
| **Grok** | `~/.grok/auth.json` | credit-usage window, reset, **on-demand / prepaid $**, plan, account type, email |

A provider that isn't set up, isn't signed in, or errors shows a clear status
(`Not set up` / `Sign in required` / `Unavailable`) instead of failing the rest —
each provider is read independently.

## Using it

1. Open **Settings → Providers**.
2. In the *Your providers* container, pick a provider from the **Add a provider**
   combobox (it flags which CLIs are detected on this machine).
3. Each activated provider gets a **tab** showing its live data:
   - **Quota windows** — a bar per window; the number is the **percent consumed**
     of that limit, with the reset countdown **and the absolute reset time**
     ("resets in 2h · 3:00 PM").
   - **Rate-limit resets** — for Codex, how many redeemable resets you have and
     **when each one expires**, with a button to **redeem one** (roll your limit
     back early) right from uxnan — behind a confirmation that shows which reset is
     used and how many remain.
   - **Credit** — a balance / $ figure when the provider exposes one (Codex, Claude,
     and Grok's on-demand-spend-vs-cap or prepaid balance).
   - **Account** — "Authenticated as …" with an **account-type** badge
     (Subscription / Pay-as-you-go / Free / Team / Enterprise); the email/login is
     blurred until you click it (click again to hide).
   - **Refresh interval** — per-provider override of the global interval.
   - **Status bar** — which of this provider's windows / plan / credit / **reset
     time** / **rate-limit resets** surface in the bottom status-bar popover (the
     primary % window is on by default).
4. The section header carries the **global refresh interval** and a master
   **status-bar indicator** toggle.

The bottom status bar shows a **gauge** button (next to the backend indicator)
whose popover lists the meters you pinned; it tints amber/red as usage nears a
limit. It's hidden when nothing is pinned. Opening the popover leaves focus where
the pointer is; closing it does not restore focus to the gauge trigger, so the
Refresh and gauge tooltips only appear when their controls are actually hovered
or explicitly focused from the keyboard. Closing the popover also cancels any
tooltip that was still waiting to appear.

## How it's read

The desktop reads usage **natively in Rust** — `src-tauri/src/usage.rs`, exposed
as the `usage_read` (fetch) and `usage_detect` (which providers are present)
Tauri commands. There's no Node dependency and no background daemon; the frontend
(`src/lib/state/usage.svelte.ts`) polls only the activated providers on the
configured interval and on demand.

Settings persisted in `AppSettings` (`src/lib/types.ts` ↔ `src-tauri/src/model.rs`):
`usageProviders` (the activated list + each one's refresh override and status-bar
picks), `usageRefreshMinutes` (global, default 5; `0` = manual), and
`usageStatusBarEnabled`.

## Contract & the phone (Phase 6)

The wire shape mirrors the shared `agent/usageStats` method (`ProviderUsage`, in
`shared/src/models/usage.ts`; spec in `architecture/02a` §5.8.10 and `02b`). The
desktop reads the files directly; a **paired phone can't see the PC's disk**, so
the embedded bridge will implement the same reader in TypeScript and serve
`agent/usageStats` (dual-reader, one contract). That side is tracked in
`bridge/FOR-DEV.md` and `uxnanmobile/FOR-DEV.md` — a natural pilot for the
Phase 6 embedded bridge.

## Verify

- Rust: `cargo test usage::` (unit tests for percentage/epoch/label parsing) +
  `cargo clippy` + `cargo fmt --check`.
- Frontend: `npm run check` (svelte-check) + `npm test` (includes
  `usageFormat.test.ts`).
