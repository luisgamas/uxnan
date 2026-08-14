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

### How it connects — and why it stays inside uxnan

The ADE runs a tiny MCP server at **`/mcp`** on the same local hook server the agent
monitor already uses (`127.0.0.1`, ephemeral port, `Authorization: Bearer <token>`).

The server is registered **per launch**: uxnan points the agent at it *in the process
it spawns*, and **writes nothing** to `~/.claude.json`, `~/.codex/config.toml`,
`~/.config/opencode/opencode.json` or any other config file you keep. So an agent you
start anywhere else — another terminal, another IDE, a CI box — never sees the server
at all: it can't discover it, can't try to reach it, and can't warn you that it is
broken. Nothing is left behind when uxnan exits either, cleanly or not.

| Agent | How it's pointed at the server |
| --- | --- |
| Claude Code | `--mcp-config <file>` — a config uxnan owns, in its own app-data folder |
| Codex | `-c mcp_servers.uxnan-browser.url=… -c mcp_servers.uxnan-browser.bearer_token_env_var=UXNAN_MCP_TOKEN` |
| OpenCode | `OPENCODE_CONFIG_CONTENT` on the terminal — merged over your own config, which is left untouched |

The **token is never written to a file**: each form references the
`UXNAN_MCP_TOKEN` environment variable, which uxnan injects into the terminal it
spawns, so the credential only ever exists inside a process uxnan started. Claude's
file is named after that window's port (`claude-<port>.json`), so two uxnan windows
open at once can never hand each other's agents the wrong endpoint.

You do see those flags on the launch line in the terminal — that is the whole
mechanism, in plain sight, and the agent's full-screen UI covers it a moment later.

**Agents you type yourself.** Because the registration rides on the command uxnan
types, an agent you start by hand in a uxnan terminal doesn't get the tools — with
one exception: OpenCode's registration is an environment variable, so it covers
every terminal uxnan spawns, typed by hand or not. Start the agent from uxnan (the
launcher, a project or worktree row, an automation) and it is always registered.
That is the trade for the guarantee: the only way an agent can be registered
*everywhere* is a config file that follows you out of the app.

The `/mcp` endpoint is guarded exactly like the hook routes: the bearer token is
compared in constant time, and a **loopback `Host`/`Origin` gate** rejects (`403`)
any non-loopback caller before the token check, so a web page can't reach it via
CSRF / DNS-rebinding.

> **Upgrading from an older version?** Versions before this one wrote the server into
> each CLI's user-global config, where it outlived the app — which is why agents run
> outside uxnan started reporting a broken `uxnan-browser` server (Codex says
> *"Environment variable UXNAN_MCP_TOKEN … is not set"* and aborts its MCP startup).
> uxnan now removes that entry, once, at startup, from all seven config files it used
> to write. Nothing else in those files is touched.

### Settings → Browser → Agent browser MCP

| Setting | What it does | Default |
| --- | --- | --- |
| **Let agents drive the browser** | Master switch for exposing the `browser_*` tools to the agents uxnan launches. Off → nothing is registered (the `/mcp` endpoint still exists for manual wiring). | On |
| **Frictionless launch** | Skip the CLI's "trust this folder?" prompt where supported — currently Codex, via a per-folder `trust_level` seed in its config. Turn off to keep the native prompt. | On |
| **Per-agent** | Toggle registration per agent. | All on |
| **Copy config** | Copy a ready-to-paste MCP-server config (endpoint + token) to wire an agent by hand — e.g. one uxnan doesn't auto-configure. That config is yours: it lives in your files and keeps working outside uxnan while the app runs, until you remove it. | — |

### Which agents are auto-configured, and why not the rest

An agent is auto-configured only when its CLI offers a **per-launch** way in — a flag
or an environment variable — verified against the real CLI. Today that is **Claude
Code**, **Codex** and **OpenCode** (the table above).

The others are not, each for a concrete reason:

- **Grok** — no MCP-config flag in `grok -h`; its only external config channel
  (`GROK_MANAGED_CONFIG`) is a signed enterprise envelope, not a per-launch override.
- **Qwen Code**, **Droid**, **MiMo Code** — config-file-only integrations; no
  per-launch flag or env verified.
- **Cursor** expands `${env:VAR}` for stdio servers but **not in the headers of a
  remote one**; **GitHub Copilot** documents header values as literal strings;
  **Antigravity**'s remote MCP transport is SSE with only a `serverUrl` and no header
  field, while uxnan's endpoint speaks Streamable HTTP; **Goose** keeps extensions in
  YAML and **Kilo Code** in JSONC.

All of them still get the `$BROWSER` shim and the `curl` route above, and any of them
can be wired by hand from the copy-paste snippet in Settings — that config is the
user's own, so removing it is their call too.

### Adding another agent

The registry is small, so wiring a new CLI is one row plus one arm in
`src-tauri/src/mcpinject.rs`:

1. **Find a per-launch mechanism and prove it.** Run the CLI against a throwaway MCP
   server and confirm it connects with the right `Authorization` header without
   touching any config file. A flag (`--mcp-config`-style), a repeatable config
   override (Codex's `-c`) or a merged-config env var (OpenCode's
   `OPENCODE_CONFIG_CONTENT`) all qualify; writing to the user's config does not.
2. Add a row to **`AGENTS`** — id, label, the executable names it is recognized by,
   and whether it is registered through `Args` or `Env`.
3. Add its arm to **`launch_args`** (flags) or **`launch_env`** (variables),
   referencing the token through the CLI's own env-expansion syntax so it never lands
   in a file or in an argument.

The frontend needs no change: the per-agent toggles and the launch path both read the
registry from the backend.

## Dialogs and menus over the browser

The page is a real **native window**, not DOM, and on every platform an owned
window paints above its owner's web content — no amount of `z-index` can put a
uxnan dialog in front of it. So the browser **steps aside on its own**: whenever a
dialog, menu, popover or select overlaps the browser panel, the page window hides
until it closes, and then comes straight back on the same URL.

That is why adding a project, picking a folder, opening a context menu or any
other overlay now works normally with the browser open, instead of the dialog
opening *behind* the page and being unclickable.

Two details worth knowing:

- Only overlays that **actually overlap** the panel hide the page — a menu on the
  far side of the window leaves your preview alone.
- **Tooltips are excluded** on purpose: they are transient and non-interactive,
  and the browser toolbar's own tooltips open right over the page, so honouring
  them would blank the preview on every hover. A tooltip that lands over the page
  stays behind it.

The same rule covers the full-screen views (Settings, Automations): they cover
the panels, so the page hides while either is open.

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
- Because it is a native window, anything uxnan draws over it has to hide it
  first (see *Dialogs and menus over the browser*): while a dialog is open the
  panel shows an empty slot instead of the page.
- The `$BROWSER` auto-interception only covers tools that honor that convention; for
  others, use the explicit `curl` call above.
