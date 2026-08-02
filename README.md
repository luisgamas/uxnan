<p align="center">
  <img src="assets/logo.svg" alt="Uxnan logo" width="72" />
</p>

<h1 align="center">Uxnan</h1>

<p align="center">
  <sub><i>Uxnan — a name with no relation to, or derivation from, any existing product.</i></sub>
</p>

<p align="center">
  <a href="https://github.com/luisgamas/uxnan/stargazers"><img src="https://img.shields.io/github/stars/luisgamas/uxnan?style=flat-square&color=f5c518&label=stars" alt="GitHub stars" /></a>
  <a href="https://github.com/luisgamas/uxnan/releases/latest"><img src="https://img.shields.io/github/v/release/luisgamas/uxnan?style=flat-square&label=desktop%20release&color=2ea44f" alt="Latest desktop release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MPL--2.0-2ea44f?style=flat-square" alt="License MPL-2.0" /></a>
  <img src="https://img.shields.io/badge/platforms-Windows_%C2%B7_macOS_%C2%B7_Linux_%C2%B7_Android-6e7681?style=flat-square" alt="Platforms" />
</p>

<p align="center">
  English · <a href="README.es.md">Español</a>
</p>

<p align="center">
  <b>Two apps built around one idea: your coding agents shouldn't need your full<br />
  attention, or your most expensive machine, to keep moving.</b>
</p>

<p align="center">
  <b>Uxnan Desktop</b> runs and reviews several CLI coding agents in parallel, each in its own<br />
  git worktree, without the memory cost of a full IDE. <b>Uxnan Mobile</b> pairs with a small<br />
  encrypted daemon on your PC so you can check on an agent, approve its next step, or send<br />
  a new instruction from your phone — across the room or across the world. They're<br />
  independent apps: run Desktop on its own, run Mobile on its own, or run both.
</p>

<p align="center">
  <a href="https://github.com/luisgamas/uxnan/releases/latest">
    <img src="https://img.shields.io/badge/Download-Uxnan_Desktop-24292e?style=for-the-badge&logo=github&logoColor=white" alt="Download Uxnan Desktop" />
  </a>
  <a href="https://sink.gamas.workers.dev/uxnan-android">
    <img src="https://img.shields.io/badge/Get-Uxnan_Mobile-01875f?style=for-the-badge&logo=googleplay&logoColor=white" alt="Get Uxnan Mobile on Google Play" />
  </a>
</p>

<p align="center">
  <img src="assets/uxnan-project.png" alt="Uxnan Desktop running four agent worktrees on a widescreen monitor, next to Uxnan Mobile showing live conversations, profile stats and a repository's GitHub checks" width="960" />
</p>

## What it feels like to use

<table>
<tr>
<td width="46%" valign="top">

### Launch any agent into its own worktree
Uxnan Desktop is terminal-centric, so it runs any CLI agent — pick one from the catalog (Claude Code, Codex, OpenCode, Pi, Grok, Antigravity, Zero) or register any other by hand, and it drops straight into an isolated terminal running its own official binary, under your own account. No API keys, no SDKs.

[Agent launch & configuration →](uxnandesktop/docs/agent-launch.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/launch-agent.gif" alt="Picking an agent from the catalog, then launching it into a worktree terminal" width="440" />

</td>
</tr>
<tr>
<td width="46%" valign="top">

### Drag a file straight into the terminal
Drag any file or folder from the tree onto a terminal and its path gets typed there — quoted if it needs to be — so an agent never has to guess a path, and neither do you.

[Git, worktrees & the file tree →](uxnandesktop/architecture/02c-git-worktrees.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/drag-file.gif" alt="Dragging a file from the file tree onto a terminal to insert its path" width="440" />

</td>
</tr>
<tr>
<td width="46%" valign="top">

### Open a PR without leaving your terminal
Push, pick `base ← head`, and create the PR — uxnan reads the repository's actual branch rules and only offers you the merge methods you're genuinely allowed to use.

[GitHub integration →](uxnandesktop/docs/github.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/create-pr.gif" alt="Creating a pull request from inside Uxnan Desktop" width="440" />

</td>
</tr>
<tr>
<td width="46%" valign="top">

### Read your history as a graph
A branch-graph gutter runs next to the commit log — click a commit to expand its changed files, click a file to open just that slice of the diff instead of one giant blob.

[Git, worktrees & diffs →](uxnandesktop/architecture/02c-git-worktrees.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/history-graph.gif" alt="Browsing the commit history with a branch graph" width="440" />

</td>
</tr>
<tr>
<td width="46%" valign="top">

### Spin up an isolated worktree in seconds
New branch, existing branch, or a custom location — every task gets its own worktree and its own agent, so nothing collides with whatever you're already running.

[Creating worktrees →](uxnandesktop/architecture/02c-git-worktrees.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/create-worktree.gif" alt="Creating a new git worktree for a task" width="440" />

</td>
</tr>
<tr>
<td width="46%" valign="top">

### Know your quota before it runs out
Session, weekly and monthly usage for Codex, Claude, Copilot and Grok, read straight from each CLI's own signed-in token — never a pasted key, never a cookie.

[Provider usage stats →](uxnandesktop/docs/providers.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/provider-usage.gif" alt="Viewing AI provider usage quotas in Settings" width="440" />

</td>
</tr>
<tr>
<td width="46%" valign="top">

### Review PRs, issues and CI in full screen
Open a project's Pull Requests, Issues and Actions in a focused view that replaces the center panel — approve, merge, comment or re-run a check without switching apps.

[GitHub integration →](uxnandesktop/docs/github.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/ci-pr-fullscreen.gif" alt="Reviewing a pull request and CI checks in the full-screen GitHub view" width="440" />

</td>
</tr>
<tr>
<td width="46%" valign="top">

### Watch subagents work under their parent
A Claude Code Task-tool subagent (or an OpenCode child session) shows up live as a nested row under the agent that spawned it — and the parent won't read "Done" while a child is still working.

[Agent hooks & precise states →](uxnandesktop/docs/agent-hooks.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/agent-subagents.gif" alt="A subagent appearing as a nested row under its parent agent" width="440" />

</td>
</tr>
</table>

## Also in the box

- **Pets** — an optional animated companion that mirrors what your agents are doing and jumps you to the right terminal when clicked. [docs →](uxnandesktop/docs/pets.md)
- **Automations** — recurring, multi-agent runs that fire on their own schedule, registered with your OS's own scheduler — they work even with uxnan closed. [docs →](uxnandesktop/docs/automations.md)
- **A measured footprint, not a guessed one** — resource mode (Efficient / Balanced / Performance) governs the background work, and the number it's tuned against is benchmarked: **~250 MB** of private memory on Windows 11 (WebView2 150, release build). [resource mode →](uxnandesktop/docs/resource-mode.md) · [benchmark method →](uxnandesktop/docs/resource-benchmarks.md)
- **Quick commands** — shell commands scoped to a project or worktree, with variable substitution, launched from a top-bar shortcut. [details →](uxnandesktop/README.md)
- **Sleep, wake, and pick up where you left off** — an idle workspace's terminals (scrollback included) come back exactly as you left them, and agent CLI sessions auto-resume. [terminal engine →](uxnandesktop/architecture/02b-terminal-engine.md)
- **Multi-agent orchestration** — broadcast one message to several agents at once, or chain them into a durable run with approvals and retries. [docs →](uxnandesktop/docs/orchestration.md)
- **A fully translated interface** — every screen in English and Spanish, not just a handful of strings. [i18n →](uxnandesktop/docs/i18n.md)
- **In-app auto-updates** — stable and nightly channels, downloaded in the background, installed only once your agents are idle. [docs →](uxnandesktop/docs/updates.md)

## Works with any CLI agent

Uxnan Desktop is terminal-centric: if it runs in a terminal, it runs in uxnan —
add any CLI as a custom agent and it launches like any other, no integration
work required. The seven below ship with **deep, first-class integration** out
of the box: precise working / blocked / waiting / done status, session
auto-resume, live model discovery, and per-agent run options.

<p align="center">
  <kbd><img src="assets/agents/claudecode.svg" width="16" valign="middle" alt="" /> Claude Code</kbd>
  <kbd><img src="assets/agents/codex.svg" width="16" valign="middle" alt="" /> Codex</kbd>
  <kbd><img src="assets/agents/opencode.svg" width="16" valign="middle" alt="" /> OpenCode</kbd>
  <kbd><img src="assets/agents/pi.svg" width="16" valign="middle" alt="" /> Pi</kbd>
  <kbd><img src="assets/agents/grok.svg" width="16" valign="middle" alt="" /> Grok</kbd>
  <kbd><img src="assets/agents/antigravity.svg" width="16" valign="middle" alt="" /> Antigravity</kbd><sup>*</sup>
  <kbd><img src="assets/agents/zero.svg" width="16" valign="middle" alt="" /> Zero</kbd>
  <kbd>+ any CLI agent</kbd>
</p>

<p align="center">
  <sub>*Antigravity's integration is partial — it runs one-shot per turn with no live approval channel.</sub>
</p>

<p align="center">
  Every one of them runs as that vendor's own official local CLI, under the account or<br />
  subscription you already signed it in with — uxnan doesn't call a provider API, hold a key,<br />
  or embed an SDK. It just drives the terminal, exactly like you would.<br />
  <b>The same seven are what Uxnan Mobile drives from your phone.</b>
</p>

---

## Uxnan Mobile — your agents, in your pocket

<!-- image added manually by the maintainer -->
<p align="center">
  <img src="assets/uxnan-mobile.png" alt="Uxnan Mobile showing a live streaming conversation, the agent and model picker, and a Git diff" width="960" />
</p>

It's a real client, not a status page: conversations **stream in live** and survive
navigating away and back, a **message queue** lets you send follow-ups while an
agent is still working, you can attach **images**, pick the **agent and model**
per conversation, see protocol-confirmed **context compactions**, and keep every
native progress/final response without losing earlier text (settled progress folds
under **N previous messages**). You can also review and stage a **Git diff** and
get a **push notification** the moment an agent finishes — all over the same
end-to-end encrypted channel the bridge speaks. Mobile offers the seven active
agents shown above; the retired Gemini CLI has no mobile product surface.

**Status: Android is alpha-ready.** iOS is written but not yet shipped — it's
waiting on Apple developer assets the project doesn't have yet.

### How it connects

Uxnan Mobile does **not** pair with Uxnan Desktop. It pairs with **`uxnan-bridge`**,
a small daemon that runs on your PC on its own — you don't need Desktop installed
at all to use Mobile, or vice versa:

```bash
npm install -g uxnan-bridge
uxnan-bridge start
```

That boots the daemon and prints the pairing QR right there in the terminal.
Scan it from the app (or type the short code it prints) and you're paired. The
phone connects **directly** over your LAN or Tailscale first, and only falls back
to an optional, self-hosted relay when you're off that network — either way, every
byte is sealed end-to-end before it leaves your phone. Full setup in
**[bridge/README.md](bridge/README.md)**.

---

## Install

### Uxnan Desktop

Grab the latest release for your platform from
**[GitHub Releases](https://github.com/luisgamas/uxnan/releases/latest)**:

| Platform | What to grab |
|---|---|
| Windows | the `.msi`, or the NSIS `_x64-setup.exe` installer |
| macOS *(experimental, unsigned)* | `_x64.dmg` (Intel) or `_aarch64.dmg` (Apple Silicon) |
| Linux | `.deb`, `.AppImage`, or `.rpm` |

Honest heads-up: the Windows installers aren't code-signed yet, so SmartScreen
will warn on first run (**More info → Run anyway**), and the macOS builds are
unsigned and unnotarized, so Gatekeeper blocks them until you authorize the app
once by hand — see the **[macOS install guide](uxnandesktop/docs/install-macos.md)**.
That's the state of an alpha project without a paid signing certificate yet, not
a sign anything is wrong. Prefer to build it yourself? See
**[building from source](uxnandesktop/docs/build.md)**.

### Uxnan Mobile

<p>
  <a href="https://sink.gamas.workers.dev/uxnan-android">
    <img alt="Get it on Google Play" src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png" height="64" />
  </a>
</p>

Android is on **[Google Play, open testing](https://sink.gamas.workers.dev/uxnan-android)**.
iOS isn't published yet, but the code is there — it's a Flutter project, so you
can build and run it yourself on your own Mac (see
**[uxnanmobile/README.md → Getting started](uxnanmobile/README.md#getting-started)**).
Heads-up: push notifications may not work on a self-built iOS app, since the
APNs signing credentials aren't included in the repo.

### The bridge (only if you want Mobile)

```bash
npm install -g uxnan-bridge
```

See **[bridge/README.md](bridge/README.md)** for the full CLI, autostart, and
per-agent sign-in prerequisites.

---

## Security

Every byte between your phone and your PC is sealed end-to-end — an X25519 key
exchange, Ed25519-signed identities, and AES-256-GCM encryption; the optional
relay only ever sees sealed envelopes, never your code. GitHub actions route
through your own `gh` CLI, which keeps its OAuth token in your OS keychain —
uxnan reads a sanitized login status and nothing else. Found a vulnerability?
Please don't open a public issue — see **[SECURITY.md](SECURITY.md)**.

## Support the project

Uxnan is free, open source, and built in my own time. If it's useful to you, a
star tells me people are actually using this — and a coffee genuinely helps keep
it moving. 🙏

<p align="center">
  <a href="https://sink.gamas.workers.dev/buymeacoffee">
    <img src="https://raw.githubusercontent.com/luisgamas/buttons-design/main/buy_me_a_coffe/buy_me_a_coffe_fill.png" height="40" alt="Buy Me a Coffee" />
  </a>
  <a href="https://sink.gamas.workers.dev/paypal-donations">
    <img src="https://raw.githubusercontent.com/luisgamas/buttons-design/main/paypal/paypal_fill.png" height="40" alt="Donate via PayPal" />
  </a>
  <a href="https://sink.gamas.workers.dev/github-sponsor">
    <img src="https://raw.githubusercontent.com/luisgamas/buttons-design/main/github_sponsor/github_sponsor_fill.png" height="40" alt="Sponsor on GitHub" />
  </a>
</p>

## Contributing

Want to build, run, or contribute to Uxnan? Start with
**[CONTRIBUTING.md](CONTRIBUTING.md)** for setup and quality gates, and
**[AGENTS.md](AGENTS.md)** — the single source of truth for conventions and
architecture rules. Each component also keeps its own `README.md`, `docs/`, and
`CHANGELOG.md`: [`uxnandesktop/`](uxnandesktop/README.md) ·
[`uxnanmobile/`](uxnanmobile/README.md) · [`bridge/`](bridge/README.md) ·
[`relay/`](relay/README.md) · [`shared/`](shared/README.md).

## License

Uxnan is released under the [Mozilla Public License 2.0](LICENSE).
