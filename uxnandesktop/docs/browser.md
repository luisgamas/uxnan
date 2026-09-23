# Integrated developer browser

A complete in-app browser for previewing and debugging what your agents build —
`localhost` dev servers and any website — and for opening the links agents create.
It is deliberately **not** a general-purpose browser (no bookmarks/profiles/
extensions); it's a developer surface.

A dev server running on an **SSH host** previews here too: the ports indicator in
the status bar forwards the port to `127.0.0.1` over that host's existing
connection and opens the result through the same routing described below, so a
remote server behaves like a local one ([remote hosts](remote-hosts.md)).

It lives in a **right-side "4th panel"**, and **every workspace has its own**.
The page is a real system webview (WKWebView on macOS, WebView2 on Windows,
WebKitGTK on Linux) drawn **inside the app window** — a child view of it, not a
separate window. So it loads **any** http(s) website (Google included), has
**real DevTools**, and behaves like the rest of the app: it moves, minimizes and
changes desktop with the window, never floats over other applications, and is
shown only while its workspace is the one on screen. It reuses the OS webview the
app already runs, so it stays light.

## One browser per workspace

A workspace — a worktree, or the Global space — has its own browser: its panel
open or closed, its page, its history and its zoom. Switching workspace hides the
page you were looking at and shows the next workspace's (when its panel is open);
coming back finds the first page exactly where you left it. A page never follows
you into a workspace it was not opened in.

Links land in the workspace they belong to:

- A link **you** open (the globe, a Ctrl/Cmd-clicked terminal link, the address
  bar) opens in the workspace on screen.
- A link an **agent** opens (its `$BROWSER`, the `curl` route or the `browser_*`
  tools) opens in the workspace **its own terminal** runs in. When that is not the
  workspace on screen, the page loads **hidden** — the agent can load, reload and
  inspect its own dev server without disturbing what you are looking at — and it
  is waiting there, panel open, when you visit that workspace.

Pages cost memory, so at most **three** stay alive at once
(`MAX_LIVE_PAGES` in `src/lib/state/browser.svelte.ts`). Opening a fourth closes
the one shown longest ago; its URL is kept, and visiting its workspace loads it
again. A workspace put to **sleep** releases its page the same way.

## Opening the browser

Opening the browser temporarily hides the Files / Changes / History / GitHub
panel. Closing the browser restores that panel only if it was open beforehand;
navigating to another URL does not change the saved preference. The review-panel
button or keyboard shortcut switches back to that panel and closes the browser.

- **Toggle it** from the status-bar **globe** button (bottom-right). It opens at
  the page the workspace last showed, else your configured *home page*, else a
  blank page.
- **From a link:** anything the ADE opens as a URL (a **Ctrl/Cmd-clicked** terminal
  link, or a link an agent opens) lands here when your link policy is *internal*
  (the default).

The browser **fills the panel** and resizes with it — drag the panel's left edge to
resize (the width is remembered). The browser has no separate size of its own.
Closing the panel closes that workspace's page; the other workspaces keep theirs.

### Chrome

Back · Forward · **Reload / Stop** (one button: Stop while the page loads;
Shift-click reloads bypassing the cache) · address bar (a lock for https, a globe
otherwise; a thin progress line while loading) · zoom level (shown only when it is
not 100 % — click to reset) · **open in system browser** · **DevTools** · close.
Back and Forward disable themselves when the page has no history that way (where
the engine reports it).

The address bar follows the page — including in-app navigations a single-page app
makes with `history.pushState` — and never overwrites what you are typing. For
`localhost` and loopback addresses it assumes `http://`; otherwise `https://`.
**Esc** restores the page's URL.

With the keyboard in the panel's toolbar: **Ctrl/Cmd+L** focuses the address bar,
**Ctrl/Cmd+R** reloads (**Shift** bypasses the cache), **Ctrl/Cmd+[** / **]** go
back / forward, **Ctrl/Cmd+=** / **−** / **0** zoom in / out / reset. Once you click
into the page, the page has the keyboard.

A link that opens a new window (`target="_blank"`, `window.open`) loads in the same
page — a developer browser has no tabs. **Downloads** go to your Downloads folder
(never overwriting a file: `name (2).ext`, …) and a notice says where.

### What it will not load

Only **http(s)** addresses open — `file:`, `data:`, `javascript:`, `tauri:` and every
other scheme is refused rather than loaded in-app; use **open in system browser**
for those. It also refuses **the app's own origin** (`tauri.localhost`,
`ipc.localhost`, `asset.localhost`, and in a development build the dev server the
app itself is served from): a page there would be treated as the app and reach its
commands. The same gate applies to navigations the page starts itself, including
redirects and iframes (which may additionally use `about:srcdoc` and `blob:`).

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
     -H "X-Uxnan-Agent-Id: $UXNAN_AGENT_ID" \
     -d '{"url":"http://localhost:5173"}'
   ```

Either way the URL is routed through your link policy, so it opens in the in-app
browser (or your system browser / a prompt, depending on the setting). The shim
sends the terminal's `UXNAN_AGENT_ID`, so the page opens in **that terminal's
workspace**; a request without it opens in the workspace on screen.

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
| `browser_open` | Open the browser of **your** workspace and load a URL (routed through the link policy); answers once the page has loaded, with its URL, title and state. |
| `browser_navigate` | Navigate your workspace's page to a URL (opening it first if needed). Same answer as `browser_open`. |
| `browser_reload` | Reload the page and answer once it has loaded again (e.g. after the agent changes code). |
| `browser_back` / `browser_forward` | Move through history; answers with the page it landed on and whether it moved. |
| `browser_status` | Report the page of your workspace (URL, title, loading, whether the person can see it, history) and how opens are routed. |

"Your workspace" is the one your terminal runs in; a caller outside a Uxnan
terminal (a script with the control token) acts on the workspace on screen. The
answer says `visible: false` when the page loaded hidden in a workspace the person
is not looking at — it works the same, they just do not see it yet.
(Page inspection/interaction — snapshot/click/type — is a planned follow-up; see
`FOR-DEV.md`.)

The browser tools are six entries of a larger list: the same MCP server carries the
whole **control surface** — `uxnan_status`, `project_*`, `worktree_*`, `terminal_*`,
`agent_list`, `run_*`, `file_open`, `file_diff`, `app_focus` and the orchestration
report tools — and the same catalog is what `uxnan-cli` speaks from a shell. See
[the control surface](./control-api.md).

### How it connects — and why it stays inside uxnan

The ADE runs a tiny MCP server at **`/mcp`** on the app's one local server — the
one the agent monitor's hooks and the control RPC also use (`127.0.0.1`, ephemeral
port, `Authorization: Bearer <token>`; `src-tauri/src/control/server.rs`).

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

### Settings → Browser → Agent tools (MCP)

These switches govern the per-launch wiring of the whole control surface — the
`browser_*` tools are six of its entries (see
[the control surface](./control-api.md)); the surface itself has no settings
pane, by design. The group stands on its own: the integrated browser's master
switch above it takes away the `$BROWSER` shim, never the tools.

| Setting | What it does | Default |
| --- | --- | --- |
| **Give launched agents the tools** | Master switch for registering the catalog — the `browser_*` tools among it — in the agents uxnan launches. Off → nothing is registered (the `/mcp` endpoint and `uxnan-cli` keep working). | On |
| **Frictionless launch** | Skip the CLI's "trust this folder?" prompt where supported — currently Codex, via a per-folder `trust_level` seed in its config. Turn off to keep the native prompt. | On |
| **Agents** | One row per supported agent — its mark, **what its launch is given** (`--mcp-config <file>`, `-c mcp_servers.uxnan-browser.*`, `OPENCODE_CONFIG_CONTENT`) and a switch. The hooks list shows the config file it writes; this one has none to show, which is the point. | All on |
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

The page is a real **native view**, not DOM, and on every platform a native view
paints above the app's web content — no amount of `z-index` can put a uxnan dialog
in front of it. So the page **steps aside on its own**: whenever a dialog, menu,
popover or select overlaps the browser panel, the page is hidden until it closes,
and then comes straight back on the same URL. If the page had the keyboard, the app
takes it back while the page is hidden.

That is why adding a project, picking a folder, opening a context menu or any
other overlay works normally with the browser open, instead of the dialog opening
*behind* the page and being unclickable.

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

A page only exists while its workspace's browser is open: it is created when the
panel (or an agent) opens it and destroyed when the panel closes, the workspace
sleeps, or it is the oldest of more than three live pages. It reuses the OS webview
runtime the app already loads (far lighter than bundling a browser). The panel
measures its slot only when something changes — a resize, the window, an overlay
opening or closing — not every frame; while the page is on screen it asks it for
what the engine does not push (an in-page URL change, the history state) every
1.5 s.

## Limitations

- It's a developer browser, not a hardened/general-purpose one (no bookmarks,
  profiles, extensions or tabs). Cookies and site data are shared by every
  workspace's page.
- Because the page is a native view, anything uxnan draws over it has to hide it
  first (see *Dialogs and menus over the browser*): while a dialog is open the
  panel shows an empty slot instead of the page.
- Keyboard shortcuts of the app do not reach it while the page itself has the
  keyboard; click the toolbar (or anywhere in the app) to give it back.
- The `$BROWSER` auto-interception only covers tools that honor that convention; for
  others, use the explicit `curl` call above.
