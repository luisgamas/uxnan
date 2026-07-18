# Integrated developer browser

A complete in-app browser for previewing and debugging what your agents build —
`localhost` dev servers and any website — and for opening the links agents create.
It is deliberately **not** a general-purpose browser (no bookmarks/profiles/
extensions); it's a developer surface.

It lives in a **right-side "4th panel"**. The page itself is a real system webview
(a frameless `WebviewWindow` — Chromium/WebView2 on Windows) **owned by** and
**docked to** uxnan: it follows the app when you move/resize it and stays above it,
so it reads as a panel. Because it's a real top-level webview (not an iframe), it
loads **any** http(s) website (Google included) and has **real DevTools**, while staying light
(it reuses the OS webview the ADE already runs). It's created when you open the
panel and destroyed when you close it.

## Opening the browser

- **Toggle it** from the status-bar **globe** button (bottom-right). It opens at
  your configured *home page*, or a blank page.
- **From a link:** anything the ADE opens as a URL (a **Ctrl/Cmd-clicked** terminal
  link, or a link an agent opens) lands here when your link policy is *internal*
  (the default).

The browser **fills the panel** and resizes with it — drag the panel's left edge to
resize (the width is remembered). The browser has no separate size of its own.

### Chrome

Back · Forward · Reload · address bar (type a URL and press Enter) · **open in
system browser** · **DevTools** · close. For `localhost` the address bar assumes
`http://`; otherwise it defaults to `https://`. The integrated browser only loads
**http(s)** URLs — any other scheme (`file:`, `tauri:`, `data:`, …) is refused
rather than loaded in-app; use **open in system browser** for those.

## Settings → Browser

| Setting | What it does | Default |
| --- | --- | --- |
| **Integrated browser** | Master switch. Off → every link opens in your system browser and agents can't use the in-app one. | On |
| **Open links** | Where links open: *in the integrated browser* (`internal`), *in my system browser* (`external`), or *ask each time* (`ask`). | Internal |
| **Let agents open links** | Inject a `$BROWSER` shim so agents' links land in-app automatically (see below). | On |
| **Clickable terminal links** | Make URLs printed in the terminal **Ctrl/Cmd-clickable** (applies to terminals opened afterwards). | On |
| **Home page** | Opened when the browser panel has no target. Blank if empty. | — |

The setting is one **decision point**: links from the UI, the terminal, and agents
all flow through the same policy, and the system browser is always available as a
fallback (the address bar's "open in system browser" button, or `external` policy).

## How an agent uses it automatically

When the browser is **enabled** and **Let agents open links** is on, every agent
terminal is launched with:

- `UXNAN_BROWSER_URL` — the local endpoint that opens a URL in the ADE.
- `UXNAN_BROWSER_TOKEN` — a per-launch secret (sent as the `X-Uxnan-Token` header).
- `BROWSER` — a path to a bundled shim (`uxnan-browser.sh` / `uxnan-browser.cmd`).

Two ways an agent ends up in the in-app browser:

1. **Automatically**, for any tool that honors the Unix `$BROWSER` convention
   (many CLIs use it for OAuth logins and "open this URL" prompts): the shim
   forwards the URL to the ADE.
2. **Explicitly**, for any agent that can run a shell command — ask it to run:

   ```sh
   curl -X POST "$UXNAN_BROWSER_URL" \
     -H "Content-Type: application/json" \
     -H "X-Uxnan-Token: $UXNAN_BROWSER_TOKEN" \
     -d '{"url":"http://localhost:5173"}'
   ```

Either way the URL is routed through your link policy, so it opens in the in-app
browser (or your system browser / a prompt, depending on the setting).

> Tip: tell your agent something like *"when you start the dev server, open its URL
> in the browser"* — if it runs `$BROWSER <url>` or the `curl` above, the preview
> shows up next to your terminal.

## Agent browser MCP (discoverable tools)

The `$BROWSER`/curl path above only works if the agent *knows* the convention. The
**browser MCP** removes that: the ADE exposes the browser as **Model Context
Protocol** tools and registers them in each agent it launches, so the tools appear
in the agent's tool list automatically — it drives the browser with **no setup and
no documentation**.

### Tools

| Tool | What it does |
| --- | --- |
| `browser_open` | Open the in-app browser and load a URL (routed through your link policy). |
| `browser_navigate` | Navigate the browser to a URL (opening the panel first if needed). |
| `browser_reload` | Reload the current page (e.g. after the agent changes code). |
| `browser_back` / `browser_forward` | Move through history. |
| `browser_status` | Report whether a page is open, the current URL, and how opens are routed. |

They map onto the same in-app browser and the same link policy as a clicked link.
(Page inspection/interaction — snapshot/click/type — is a planned follow-up; see
`FOR-DEV.md`.)

### How it connects

The ADE runs a tiny MCP server at **`/mcp`** on the same local hook server the agent
monitor already uses (`127.0.0.1`, ephemeral port, `Authorization: Bearer <token>`).
When enabled, the ADE writes the agent CLI's **own user-global** MCP config (in
`~/.claude.json`, `~/.codex/config.toml`, `~/.gemini/settings.json`,
`~/.config/opencode/opencode.json`) so it finds that server on launch — **never a
file in your project folder.** User-global config isn't project-approval-gated, so no
CLI shows an "approve this MCP server?" prompt. The bearer **token is never written
to a file** — the config references the `UXNAN_MCP_TOKEN` environment variable, which
the ADE injects into the terminal it spawns.

That env-scoping is deliberate: **the injected config only works inside a terminal
uxnan launched.** The same agent run in another IDE/terminal reads the same config
file but has no `UXNAN_MCP_TOKEN`, so it can't authenticate — the server simply
doesn't load for it (it won't hijack your in-app browser). The worst case outside
uxnan is a harmless, non-connecting entry, which uxnan removes on exit.

The `/mcp` endpoint is guarded exactly like the hook routes: the bearer token is
compared in constant time, and a **loopback `Host`/`Origin` gate** rejects (`403`)
any non-loopback caller before the token check, so a web page can't reach it via
CSRF / DNS-rebinding.

### Settings → Browser → Agent browser MCP

| Setting | What it does | Default |
| --- | --- | --- |
| **Agent browser MCP** | Master switch for exposing the `browser_*` tools to agents. Off → no MCP config is injected (the `/mcp` endpoint still exists for manual wiring). | On |
| **Setup mode** | `Managed` registers the server in each CLI's **user-global** config only — never your project folder, so nothing lands in your files and no "approve this MCP server?" prompt appears (hand-typed agents pick it up too). `Global` is the same user-global config but leaves the CLIs' own trust prompts intact. `Off` injects nothing. | Managed |
| **Frictionless launch** | (Managed only) Skip the CLI's "trust this folder?" prompt for app-launched agents — Gemini via `GEMINI_CLI_TRUST_WORKSPACE`, Codex via a per-folder `trust_level` seed. Turn off to keep the native prompts. | On |
| **Per-agent** | Toggle injection per agent. | All on |
| **Copy config** | Copy a ready-to-paste MCP-server config (endpoint + token) to wire an agent by hand — e.g. one the ADE doesn't auto-configure yet. | — |

> The legacy **Workspace** mode (project-scoped config files in the working
> directory) was removed — it was the only thing that put files in your project and
> triggered per-project approval prompts. A saved `Workspace` choice becomes
> `Managed`.

### Where each agent's config is written

The ADE writes each CLI's native config in its **user-global** location (never the
project folder). The token is always referenced via `UXNAN_MCP_TOKEN` (never inlined):

| Agent | User-global file | Shape |
| --- | --- | --- |
| Claude Code | `~/.claude.json` | `mcpServers.uxnan-browser` `{type:"http", url, headers}` |
| Codex | `~/.codex/config.toml` | `[mcp_servers.uxnan-browser]` `url` + `bearer_token_env_var` |
| Gemini CLI | `~/.gemini/settings.json` | `mcpServers.uxnan-browser` `{httpUrl, trust, headers}` |
| OpenCode | `~/.config/opencode/opencode.json` | `mcp.uxnan-browser` `{type:"remote", url, headers, enabled}` |

Merges are non-destructive (your other keys/servers are preserved), and uxnan removes
its own entry on exit. Gemini's entry carries `trust: true` so it doesn't ask for
per-tool confirmation of the browser server.

### Adding another agent

The injector is a small registry, so wiring a new CLI (e.g. `agy`/Antigravity,
Cursor's `cursor-agent`, Grok, amp, Pi, …) is three edits in `src-tauri/src/mcpinject.rs`:

1. Add a row to **`AGENTS`** — its stable id and label.
2. Add a match arm to **`config_path`** — where its **user-global** MCP config file
   lives, relative to `$HOME`.
3. Add its server shape to **`json_entry`** (JSON configs) or handle it in
   **`write_entry`** (a non-JSON format, like Codex's TOML). Reference the token via
   the CLI's own env-expansion syntax so it's never written to the file.

Then add the agent's id to the frontend's per-agent toggle list. Nothing else
changes — injection, merging and cleanup are format-driven.

## Performance

The browser only consumes resources while the panel is open: the webview window is
created when you open the panel and destroyed when you close it, and it reuses the
OS webview runtime the app already loads (far lighter than bundling a browser).
Keep heavy pages closed when you don't need them.

## Limitations

- It's a developer browser, not a hardened/general-purpose one (no bookmarks,
  profiles or extensions).
- The page is a separate (owned) window glued over the panel, so during a fast
  app-window resize it may lag a frame before it catches up.
- The `$BROWSER` auto-interception only covers tools that honor that convention; for
  others, use the explicit `curl` call above.
