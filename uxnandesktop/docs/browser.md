# Integrated developer browser

A complete in-app browser for previewing and debugging what your agents build —
`localhost` dev servers and any website — and for opening the links agents create.
It is deliberately **not** a general-purpose browser (no bookmarks/profiles/
extensions); it's a developer surface.

A dev server running on an **SSH host** previews here too: the ports indicator in
the status bar forwards the port to `127.0.0.1` over that host's existing
connection and opens the result through the same routing described below, so a
remote server behaves like a local one ([remote hosts](remote-hosts.md)).

It is one of the **right dock's surfaces** (next to Files, Git and GitHub — see
[the right dock](#the-right-dock)), and **every workspace has its own**.
The page is a real system webview (WKWebView on macOS, WebView2 on Windows,
WebKitGTK on Linux) drawn **inside the app window** — a child view of it, not a
separate window. So it loads **any** http(s) website (Google included), has
**real DevTools**, and behaves like the rest of the app: it moves, minimizes and
changes desktop with the window, never floats over other applications, and is
shown only while its workspace is the one on screen. It reuses the OS webview the
app already runs, so it stays light.

## One browser per workspace

A workspace — a worktree, or the Global space — has its own browser: its page,
its history and its zoom (and, like everything in the dock, whether the dock is
open and on which surface). Switching workspace hides the page you were looking
at and shows the next workspace's (when its dock is showing the browser);
coming back finds the first page exactly where you left it. A page never follows
you into a workspace it was not opened in.

Links land in the workspace they belong to:

- A link **you** open (a Ctrl/Cmd-clicked terminal link, the address bar) opens
  in the workspace on screen.
- A link an **agent** opens (its `$BROWSER`, the `curl` route or the `browser_*`
  tools) opens in the workspace **its own terminal** runs in. When that is not the
  workspace on screen, the page loads **hidden** — the agent can load, reload and
  inspect its own dev server without disturbing what you are looking at — and it
  is waiting there, the dock open on it, when you visit that workspace.

Pages cost memory, so at most **three** stay alive at once
(`MAX_LIVE_PAGES` in `src/lib/state/browser.svelte.ts`). Opening a fourth closes
the one shown longest ago; its URL is kept, and visiting its workspace loads it
again. A workspace put to **sleep** releases its page the same way.

## The right dock

The right side of the window is **one dock** with the surfaces the workspace on
screen actually has — **Files** (a project), **Git** (a git repository: its
Changes and History views behind one segmented control), **GitHub** (a local git
repository, when the GitHub panel is enabled) and **Browser** (when the browser
is enabled). A plain folder offers no Git or GitHub; the Global space offers only
the browser. `src/lib/state/dock.svelte.ts` holds the rules.

- **Open or close it** with the status-bar dock button (bottom-right) or its
  shortcut (**Mod+J** by default). It reopens on the surface it last showed in
  that workspace.
- **The first time** a workspace opens its dock, nothing is chosen yet: the dock
  shows a chooser, one card per surface, each with its shortcut.
- **Switch surface** from the selector in the dock's top band — each option
  carries what is worth knowing without opening it (changed files, the pull
  request's checks, an agent waiting for approval) — or jump straight to one with
  its shortcut: **Mod+Shift+E** Files, **Mod+Shift+G** Git, **Mod+Shift+H**
  GitHub, **Mod+Shift+B** Browser (each opens the dock when it is closed).
- A worktree's changed-files count in the sidebar opens its **Git → Changes**.

Each workspace remembers its own dock — open or closed, the surface, the Git
view — in `settings.dock` (the last 200 workspaces used).

## Opening the browser

- **Show it** from the dock's selector or chooser, or with **Mod+Shift+B**. It
  opens at the page the workspace last showed, else your configured *home page*,
  else an empty state waiting for an address.
- **From a link:** anything the ADE opens as a URL (a **Ctrl/Cmd-clicked** terminal
  link, or a link an agent opens) lands here when your link policy is *internal*
  (the default).

The browser **fills the dock** and resizes with it — drag the dock's left edge to
resize. The browser keeps a width of its own (wider than the other surfaces'), so
widening it for a page never leaves Files or Git stretched.

Leaving the browser surface, or closing the dock, only **hides** the page: it is
there, scrolled where you left it, when you come back. The toolbar's **✕** does
what Settings → Browser → *Close button* says: **clear the page** (the default —
that workspace's page is released and its history cleared, leaving the browser
empty as on its first open), **go back to the home page** (clearing it when none
is set), or **close the browser and the panel**. The other workspaces keep
their pages either way.

### Chrome

Back · Forward · **Reload / Stop** (one button: Stop while the page loads;
Shift-click reloads bypassing the cache) · address bar (a lock for https, a globe
otherwise; a thin progress line while loading) · zoom level (shown only when it is
not 100 % — click to reset) · **open in system browser** · **DevTools** (in a
window of their own — docked, WebKit's inspector took over the whole app window)
· close page.
Back and Forward disable themselves when the page has no history that way (where
the engine reports it).

The address bar follows the page — including in-app navigations a single-page app
makes with `history.pushState` — and never overwrites what you are typing. What
you type there always leads somewhere, as in any browser (`resolveAddress` in
`src/lib/browserAddress.ts`):

- an address with a scheme loads as it is;
- this machine and the local network — `localhost`, loopback, `*.localhost`, an
  IPv4 address, `host:port` — load over `http://` (a dev server);
- a domain name (`example.com`, `docs.rs/serde`) loads over `https://`;
- anything else — words, a phrase, a single name — is **searched** with the
  search engine chosen in Settings → Browser.

**Esc** restores the page's URL.

With the keyboard in the panel's toolbar: **Ctrl/Cmd+L** focuses the address bar,
**Ctrl/Cmd+R** reloads (**Shift** bypasses the cache), **Ctrl/Cmd+[** / **]** go
back / forward, **Ctrl/Cmd+=** / **−** / **0** zoom in / out / reset. Once you click
into the page, the page has the keyboard — its own keys first (find, reload and
the other browser keys work there) — and the app's **global** shortcuts still
work from inside it: the dock toggle, the dock surfaces, the sidebar, new
terminals, the palettes, Settings. Shortcuts that act on the focused tab or
split (close tab, cycle tabs) need the app's UI focused. How that is routed per
platform is in [the keyboard guide](keyboard.md).

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
| **Let agents use other sites** | Let agents read and act on pages outside this machine. Off: the page tools work only on local pages (their dev servers). On: each site still needs your approval once, and high-risk actions every time (see *Agents reading and using the page*). | Off |
| **Home page** | Opened when the browser has no page to show. Blank if empty. | — |
| **Close button** | What the toolbar's ✕ does: clear the page, go back to the home page, or close the browser and the panel. | Clear the page |
| **Search engine** | Where the address bar sends what is not an address: Google (default), DuckDuckGo, Bing, Brave Search, or a custom URL with `%s` for the query (an unusable one searches Google). | Google |

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
| `browser_snapshot` | Read the page as a compact outline, every interactive element carrying a `ref`. |
| `browser_screenshot` | See the page: a PNG taken by the engine itself. |
| `browser_console` | Read what the page logged — messages, warnings, errors, uncaught exceptions. |
| `browser_wait` | Wait until the page shows some text (up to 30 s). |
| `browser_click` / `browser_type` / `browser_press` / `browser_scroll` | Use the page: click, type into a field (or pick a select option), press a key, scroll — by `ref`. |

"Your workspace" is the one your terminal runs in; a caller outside a Uxnan
terminal (a script with the control token) acts on the workspace on screen. The
answer says `visible: false` when the page loaded hidden in a workspace the person
is not looking at — it works the same, they just do not see it yet. How the page
tools behave, and what they may not do, is in *Agents reading and using the page*
below.

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
| OpenCode | `OPENCODE_CONFIG_CONTENT` on the terminal — merged over your own config, which is left untouched. OpenCode 2 is also launched `--standalone` (below) |

The **token is never written to a file**: each form references the
`UXNAN_MCP_TOKEN` environment variable, which uxnan injects into the terminal it
spawns, so the credential only ever exists inside a process uxnan started. Claude's
file is named after that window's port (`claude-<port>.json`), so two uxnan windows
open at once can never hand each other's agents the wrong endpoint.

You do see those flags on the launch line in the terminal — that is the whole
mechanism, in plain sight, and the agent's full-screen UI covers it a moment later.

**Agents you type yourself.** Because the registration rides on the command uxnan
types, an agent you start by hand in a uxnan terminal doesn't get the tools — with
one exception: OpenCode 1's registration is an environment variable, so it covers
every terminal uxnan spawns, typed by hand or not. Start the agent from uxnan (the
launcher, a project or worktree row, an automation) and it is always registered.
That is the trade for the guarantee: the only way an agent can be registered
*everywhere* is a config file that follows you out of the app.

**OpenCode 2 gets the variable only where uxnan launches it.** OpenCode 2 runs its
agent — and its MCP servers — in a background service shared by every `opencode`
on the machine, which keeps the environment of the terminal that started it and
outlives both that terminal and uxnan. A variable on every terminal would reach
that service the first time you typed `opencode` by hand: the tools would then act
as that one tab for every OpenCode client, uxnan's or not, and point at a port and
token that stop working when uxnan restarts — the very failure the per-launch rule
exists to prevent. So, with OpenCode 2 installed, `OPENCODE_CONFIG_CONTENT` is set
only on a terminal uxnan opens to launch OpenCode, and that launch runs
`--standalone`: a private server, child of the tab's TUI, that dies with it (see
[agent launch](./agent-launch.md) → *OpenCode 2*). A hand-typed `opencode` there
gets no tools, like every other hand-typed agent.

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
  **Goose** keeps extensions in
  YAML and **Kilo Code** in JSONC.
- **Antigravity** (`agy` 1.2.10) takes Streamable HTTP servers with literal headers,
  but only in its user-global `~/.gemini/config/mcp_config.json` (`agy mcp add`) —
  no per-launch flag or environment.

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

## Agents reading and using the page

An agent building a web app needs to *see* what it built and *try* it: open the
dev server, read what rendered, fill a form, press the button, check the console.
The page tools do exactly that, and nothing more — there is no "run this
JavaScript" tool, no CSS selectors and no screen coordinates.

**Snapshot, then act by reference.** `browser_snapshot` returns the page as an
outline — one line per heading, text, link, button or field, with its state and
value (a password field says only that it is filled) — and gives every
interactive element a reference like `k3p9:e12`. The actions take that
reference. A reference names an element of **one document**: after a navigation
or a reload the old ones are refused ("take a new snapshot"), so an agent can
never act on a page it has not looked at. Before acting, the element is scrolled
into view and must be visible, enabled and not covered by something else — a
click that would land on an overlay is refused and says what covers the element.
Actions answer once any navigation they caused has loaded, and can return the new
snapshot in the same call (`snapshot: true`).

**Evidence, not proof.** The outline and the screenshot are what the page
produced about itself; a page can misdescribe its own buttons. That is why the
safety rules below lean cautious.

### What needs the person

| | reading (snapshot, screenshot, console, wait) | ordinary actions (links, buttons, typing, scrolling, keys) | high-risk actions |
| --- | --- | --- | --- |
| **A page on this machine** — `localhost`, `127.0.0.1`, `*.localhost`, a forwarded SSH port | allowed | allowed | **you approve each one** |
| **Another site**, while *Let agents use other sites* is off (the default) | refused | refused | refused |
| **Another site**, with it on | **you approve the site once** | **you approve the site once** | **you approve each one** |

**High-risk** is submitting a form (a submit button, Enter in a form field) or
clicking anything whose name reads as deleting, removing, paying, buying,
publishing, deploying, sending, confirming, signing in or up, granting,
authorizing or merging (English and Spanish). **Typing into a password or file
field is refused everywhere, always** — an agent never handles a credential or a
file for you; it asks you to do it.

**Approving.** The request appears as an amber bar above the page, in the browser
panel of the agent's workspace, naming the agent, the element (highlighted in
the page), what it would do and the site: **Deny**, **Allow** (this action), or —
for a site outside this machine — **Allow on *site*** (reads and ordinary actions
there stop asking until the page closes). When the request is in a workspace you
are not looking at, or its dock is not showing the browser, the status-bar dock
button gets an amber dot; clicking it takes you there. The agent waits **45 seconds**, then its
call is refused with a message telling it to explain what it wants and ask
again. Nothing about approvals is remembered: closing the page, a restart or a
navigation ends them, and an approval is for the document the agent looked at —
if the page navigated meanwhile, the action is refused.

**What is logged.** Every action an agent takes in a page — done or refused —
leaves a line in the control audit log (`control-audit.log` in the app's data
folder): who, which action, which reference, whether it ran. Typed text is
recorded by length only.

**Platform notes.** The screenshot is taken by the engine itself: WebKit's
snapshot on **macOS** (verified), WebView2's `CapturePreview` on **Windows** and
WebKitGTK's snapshot on **Linux** — those two build and are unit-tested on CI but
have not been run on a real machine yet. If a capture fails, `browser_screenshot`
says so; the rest of the tools do not depend on it.

## Dialogs and menus over the browser

The page is a real **native view**, not DOM, and on every platform a native view
paints above the app's web content — no amount of `z-index` can put a uxnan dialog
in front of it. So the page **steps aside on its own**: whenever a dialog, menu,
popover or select overlaps the browser panel, the page is hidden until it closes,
and then comes straight back on the same URL. If the page had the keyboard, the app
takes it back while the page is hidden.

That is why adding a project, picking a folder, opening a context menu or any
other overlay works normally with the browser open, instead of the dialog opening
*behind* the page and being unclickable. Where the page can be captured, the
panel keeps showing a **still image** of it under the dialog
instead of going blank.

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

A page only exists while its workspace has one open: it is created when you (or
an agent) open it and destroyed when its ✕ closes it, the workspace sleeps, or it
is the oldest of more than three live pages — hiding it (another dock surface, the
dock closed, another workspace) keeps it. It reuses the OS webview
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
  panel shows a still image of the page (an empty slot if the capture fails).
- With the page focused, only the app's global shortcuts work (see
  [the keyboard guide](keyboard.md)); click the toolbar (or anywhere in the app)
  for the rest.
- The `$BROWSER` auto-interception only covers tools that honor that convention; for
  others, use the explicit `curl` call above.
