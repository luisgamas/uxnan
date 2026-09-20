# Provider usage statistics

Settings → **Providers** shows how much of each AI provider's quota you've
consumed — quota/rate windows (percent **used** + reset countdown **and the
absolute reset time**), your plan and **account type**, any credit / $ balance, and
Codex's redeemable rate-limit **resets** — for the providers you activate. Only
activated providers are ever read, so an idle feature costs nothing.

## Supported providers

Usage is read from each CLI's **own signed-in token**, calling the provider's
**official usage API**. Posture: never browser cookies, never API keys you paste
into Uxnan — only the token the CLI itself stored, read from wherever the CLI
keeps it (a file, or the OS credential store — see *How Uxnan reaches a token*).

| Provider | Where the CLI keeps its token | Reads |
|---|---|---|
| **Codex** | `~/.codex/auth.json` | monthly/weekly windows, plan, credit, **rate-limit resets**, account type, email |
| **Claude Code** | `~/.claude/.credentials.json` on Windows / Linux; the **login Keychain** on macOS (`Claude Code-credentials`), read after a one-time grant | session (5h) / weekly / model-scoped windows, plan, account type, email + organization (from `~/.claude.json`) |
| **GitHub Copilot** | `gh auth token` | premium/chat/completions quotas, plan, account type, GitHub login |
| **Grok** | `~/.grok/auth.json` | credit-usage window, reset, **on-demand / prepaid $**, plan, account type, email |

A provider that isn't set up, isn't signed in, or errors shows a clear status
(`Not set up` / `Sign in required` / `Access required` / `Unavailable`) instead
of failing the rest — each provider is read independently. `Sign in required`
also covers an **expired** access token: Claude Code only refreshes its token
while it runs, so after a long pause the panel says to open Claude Code once
rather than pretending you signed out.

**A live provider can still have no meter.** Quota windows are percentages of an
allowance, so an account billed by spend has none to report — a pay-as-you-go
Grok account returns no `creditUsagePercent`, and with no on-demand cap and
nothing spent there is no balance worth drawing either. That is not a failure
and not a sign-in problem: the provider reads `Live`, and the status-bar
section says the account reports no window rather than telling you to sign in
again.

## How Uxnan reaches a token

Same rules on every platform, whatever the store:

- Only the **access token** is used. A refresh token is never read into a
  value, never sent anywhere and never used to mint a new access token — the
  CLIs treat refresh reuse as a compromised session, and Uxnan must never be the
  reason you get signed out.
- The token lives in the Rust process for the length of one HTTP call. It never
  crosses the Tauri IPC, is never logged, never persisted, and never appears in
  a status message. The raw bytes are wiped once parsed.
- **Files** (Windows, Linux, and macOS for every CLI but Claude Code) are read in
  place with the same OS permission the CLI relies on; nothing is copied.
- **The OS credential store** is read through the platform API behind an
  explicit, OS-mediated grant. Today that is macOS for Claude Code
  (`src-tauri/src/credstore.rs`, on Security.framework):
  1. Every **poll runs with OS user interaction disabled**. If macOS would have
     to ask you, the read fails quietly and the provider shows **Access
     required** with a **Grant access** button — a background refresh can never
     pop a dialog.
  2. **Grant access** performs the one interactive read. macOS shows its own
     dialog for the `Claude Code-credentials` item; choose **Always Allow** so
     Uxnan is recorded in that item's access list and later polls stay silent.
     (Plain *Allow* works once; the next poll returns to *Access required*.)
  3. The grant is **owned by macOS**, not by Uxnan: Uxnan stores nothing about
     it. Revoke it any time in **Keychain Access → `Claude Code-credentials` →
     Access Control**; the panel returns to *Access required* on the next poll.
  4. While the app is ad-hoc signed (today's DMG), macOS ties the grant to the
     exact build, so an **update asks for it again** — one click, never a
     storm. A Developer ID signature (`FOR-HUMAN.md`) makes it permanent across
     versions.

  Claude Code names the item from its config dir — `Claude Code-credentials`,
  plus `-<sha256(dir)[..8]>` under a custom `CLAUDE_CONFIG_DIR` — with your login
  user as the account; Uxnan derives both the same way, and honors
  `CLAUDE_CONFIG_DIR` for the file path too. A `~/.claude/.credentials.json`
  present on macOS wins over the Keychain, as it does for the CLI.

  Windows Credential Manager and Linux Secret Service have no reader yet
  because no wired CLI keeps its token there by default. When one does
  (Antigravity; Codex switched to its opt-in `keyring` store), it goes into the
  same module with the same never-prompt / grant-once contract.

### What's missing

**Antigravity is not a provider yet.** Its quota sits behind the same Google Code
Assist API this reader already speaks, and `credstore.rs` is now the door to the
OS-keyring token `agy` keeps (Windows Credential Manager / macOS Keychain / Linux
Secret Service) — what is still missing is the **item names** it uses, which are
undocumented and must be verified on a real install per platform, plus the
Windows / Linux halves of the store reader. The findings are in
[`FOR-DEV.md`](../FOR-DEV.md) → *Providers (usage statistics)*.

**Codex in `keyring` mode.** Codex reads its token from `~/.codex/auth.json` by
default; a user who opted into `cli_auth_credentials_store = "keyring"` / `"auto"`
moves it into the OS store, where this reader does not look yet, so the tab
reads *Not set up*. Same follow-up, same module — tracked in `FOR-DEV.md`.

**The phone does not get Claude's macOS usage yet.** The bridge serves the same
contract from the same files, but it does not open the Keychain — its Node binary
would need a grant of its own and cannot keep a poll silent — so on a Mac it
reports the honest state and points at the desktop app (`bridge/FOR-DEV.md`).

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
as the `usage_read` (fetch), `usage_detect` (which providers are present) and
`usage_grant_access` (the one interactive OS-store read, see above) Tauri
commands. There's no Node dependency and no background daemon; the frontend
(`src/lib/state/usage.svelte.ts`) performs an initial read for every activated
provider, catches up missing or stale snapshots when the app regains focus, and
maintains one timer per provider. A provider's override wins over the global
interval; `0` disables only its repeating timer, not the initial or manual read.
The active resource-mode policy may lengthen an inherited or explicit cadence.

Provider percentages are normalized at the native boundary. In particular,
Codex's `used_percent` values are percentage points already: `1` means 1% used,
not a fractional 100%. This matters immediately after a quota reset, when the
reported value commonly falls at or below one.

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

- Rust: `cargo test --lib -- usage:: credstore::` (percentage/epoch/label
  parsing, the Claude Keychain item derivation and expiry check, the store's
  error mapping and a quiet read that must never prompt) + `cargo clippy` +
  `cargo fmt --check`.
- Frontend: `npm run check` (svelte-check) + `npm test` (includes
  `usageFormat.test.ts`, `usageSchedule.test.ts` and
  `ProviderUsageEditor.svelte.test.ts` for the grant flow).
- **On a Mac, by hand** (the grant cannot be automated): add Claude Code → the
  tab reads *Access required* with **no** dialog → *Grant access* → macOS asks →
  *Always Allow* → *Live*; a manual Refresh and an app restart stay silent;
  revoking in Keychain Access brings *Access required* back on the next poll.
