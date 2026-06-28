# Integrated developer browser

A lightweight in-app browser **tab** for previewing and debugging what your agents
build — `localhost` dev servers and most websites — and for opening the links
agents create. It is deliberately **not** a general-purpose browser (no
bookmarks/profiles/extensions); it's a developer preview surface.

It's rendered as a plain **`<iframe>`** inside the app, so it's a real center tab
that composes with the layout (split it beside a terminal), can never freeze the
app or paint over menus, and is very light — just another browsing context in the
webview the ADE already runs. Some public sites refuse to be embedded (they send an
`X-Frame-Options` / `frame-ancestors` header) and will appear blank; for those use
**open in system browser** (see below). `localhost` dev servers almost never block
embedding.

## Opening a browser tab

- **Manually:** the center "+" (new-tab) menu → **New browser tab**. It opens at
  your configured *home page*, or a blank page.
- **From a link:** anything the ADE opens as a URL (a **Ctrl/Cmd-clicked** terminal link, or a
  link an agent opens) lands here when your link policy is *internal* (the default).

The browser is a normal center tab: you can split it beside a terminal, drag it
between regions, and have several open at once.

### Chrome

Back · Forward · Reload · address bar (type a URL and press Enter) · **open in
system browser**. For `localhost` the address bar assumes `http://`; otherwise it
defaults to `https://`. To inspect a page, use the app's own DevTools (they reach
into the iframe).

## Settings → Browser

| Setting | What it does | Default |
| --- | --- | --- |
| **Integrated browser** | Master switch. Off → every link opens in your system browser and agents can't use the in-app one. | On |
| **Open links** | Where links open: *in the integrated browser* (`internal`), *in my system browser* (`external`), or *ask each time* (`ask`). | Internal |
| **Let agents open links** | Inject a `$BROWSER` shim so agents' links land in-app automatically (see below). | On |
| **Clickable terminal links** | Make URLs printed in the terminal **Ctrl/Cmd-clickable** (applies to terminals opened afterwards). | On |
| **Home page** | Opened when a new browser tab has no target. Blank if empty. | — |

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

## Performance

The in-app browser only consumes resources while a browser tab is open (it's an
iframe in the webview the app already runs, far lighter than a separate browser).
Keep heavy pages closed when you don't need them.

## Limitations

- It's a developer preview surface, not a hardened/general-purpose browser.
- Sites that send `X-Frame-Options` / `frame-ancestors` refuse to be embedded and
  render blank — use **open in system browser** for those. `localhost` dev servers
  almost never block embedding.
- The `$BROWSER` auto-interception only covers tools that honor that convention; for
  others, use the explicit `curl` call above.
