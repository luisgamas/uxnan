# Integrated developer browser

A complete in-app browser for previewing and debugging what your agents build —
`localhost` dev servers and any website — and for opening the links agents create.
It is deliberately **not** a general-purpose browser (no bookmarks/profiles/
extensions); it's a developer surface.

It lives in a **right-side "4th panel"**. The page itself is a real system webview
(a frameless `WebviewWindow` — Chromium/WebView2 on Windows) **owned by** and
**docked to** uxnan: it follows the app when you move/resize it and stays above it,
so it reads as a panel. Because it's a real top-level webview (not an iframe), it
loads **any** site (Google included) and has **real DevTools**, while staying light
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
`http://`; otherwise it defaults to `https://`.

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
