<p align="center">
  <img src="assets/logo.svg" alt="Uxnan logo" width="72" />
</p>

<h1 align="center">Uxnan</h1>

<p align="center">
  <sub><i>Uxnan — a name with no relation to, or derivation from, any existing product.</i></sub>
</p>

<p align="center">
  <a href="https://github.com/luisgamas/uxnan/releases/latest"><img src="https://img.shields.io/github/v/release/luisgamas/uxnan?style=for-the-badge&label=desktop%20release&color=2ea44f" alt="Latest desktop release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MPL--2.0-2ea44f?style=for-the-badge" alt="License MPL-2.0" /></a>
  <img src="https://img.shields.io/badge/platforms-Windows_%C2%B7_macOS_%C2%B7_Linux_%C2%B7_Android-6e7681?style=for-the-badge" alt="Platforms" />
</p>

<p align="center">
  English · <a href="README.es.md">Español</a>
</p>

<p align="center">
  <b>Start it in a terminal. Pick it up anywhere.</b><br />
  One ecosystem for the coding agents you already use: a session moves from a terminal<br />
  to a chat to your phone without starting over.
</p>

<p align="center">
  <b>Uxnan Desktop</b> runs and reviews several CLI coding agents in parallel, each in its own<br />
  git worktree, without the memory cost of a full IDE. <b>Uxnan Mobile</b> pairs with the<br />
  <b>Uxnan bridge</b>, a small encrypted daemon on your PC, so you can check on an agent, approve<br />
  its next step, or send a new instruction from your phone, across the room or across the world.<br />
  Each one works on its own: Desktop needs nothing else, and Mobile needs only the bridge.<br />
  When they meet, they converge: projects, conversations and settings are the same on both,<br />
  even after one of them was offline.
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
  <img src="assets/uxnan-ecosystem.png" alt="Uxnan Desktop with Claude Code in a terminal next to the integrated browser, beside Uxnan Mobile showing an OpenCode conversation with its work log and the agents it can start; a close-up shows a chat's steps as they run" width="960" />
</p>

## What it feels like to use

<table>
<tr>
<td width="46%" valign="top">

### Start it in a terminal, pick it up anywhere
An agent's session isn't tied to where it started. Run Claude Code in a desktop terminal, then **Continue as chat** when you'd rather read than scroll: Uxnan closes the agent there (a signal to its process, never keystrokes) and the chat carries on with its history. **Open in terminal** takes it back. On your phone, a session still open in a PC terminal says so, and **Continue here** asks the PC to hand it over once the agent is idle. A new chat also lists the sessions your agents had in that folder, from a terminal, their own app or another surface, so you can pick any of them up. One writer at a time, and the agent keeps its memory when the bridge restarts.

[Terminal ⇄ chat →](uxnandesktop/docs/chat.md#from-a-terminal-to-a-chat-and-back)

</td>
<td width="54%" valign="top">

<p align="center"><img src="assets/uxnan-continue-here.png" alt="Uxnan Mobile showing a Claude Code session started in a desktop terminal, with its history, a work log and the banner: This conversation is open in a terminal on the PC, Continue here" width="260" /></p>

</td>
</tr>
<tr>
<td width="46%" valign="top">

### One conversation, on your desktop and your phone
A chat runs on the Uxnan bridge, so the desktop and the phone show the same conversation, live: every step the agent takes, every answer as it streams. Send from either one: the other sees it at once, and neither needs the other to keep working.

[Chat →](uxnandesktop/docs/chat.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/chat-desktop-mobile.gif" alt="A Claude Code chat answered live on Uxnan Desktop and Uxnan Mobile at once, then continued from the phone" width="440" />

</td>
</tr>
<tr>
<td width="46%" valign="top">

### Agents that work together
Any agent Uxnan runs can drive Uxnan itself through `uxnan-cli` or its MCP tools — nothing else to install. Here Claude Code hands a task to OpenCode as a chat, waits for it and reads the answer back.

[Control surface: CLI & MCP →](uxnandesktop/docs/control-api.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/agents-together.gif" alt="Claude Code starting a chat with OpenCode through uxnan-cli, OpenCode searching the repository, and Claude Code summarizing its answer" width="440" />

</td>
</tr>
<tr>
<td width="46%" valign="top">

### A real browser your agents can use
Each workspace has its own browser beside its terminals. An agent opens your app there, scrolls, clicks and reads it — the same page you see.

[Browser →](uxnandesktop/docs/browser.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/real-browser.gif" alt="Claude Code opening a local site in Uxnan's browser, scrolling to a section and clicking through to GitHub" width="440" />

</td>
</tr>
<tr>
<td width="46%" valign="top">

### Launch any agent into its own worktree
Uxnan Desktop is terminal-centric, so it runs any CLI agent — pick one from the catalog (Claude Code, Codex, OpenCode, Pi, Grok, Antigravity, Zero) or register any other by hand, and it drops straight into an isolated terminal running its own official binary, under your own account. No API keys, no SDKs.

[Agent launch & configuration →](uxnandesktop/docs/agent-launch.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/one-click-launch.gif" alt="Picking Claude Code from the new-tab menu and launching it into a terminal of the worktree" width="440" />

</td>
</tr>
<tr>
<td width="46%" valign="top">

### Drag a file straight into the terminal
Drag any file or folder from the tree onto a terminal and its path gets typed there — quoted if it needs to be — so an agent never has to guess a path, and neither do you.

[Git, worktrees & the file tree →](uxnandesktop/architecture/02c-git-worktrees.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/drag-file.gif" alt="Dragging AGENTS.md from the file tree onto a terminal, which types its path into a wc -l command" width="440" />

</td>
</tr>
<tr>
<td width="46%" valign="top">

### Open a PR without leaving your terminal
Push, pick `base ← head`, and create the PR — uxnan reads the repository's actual branch rules and only offers you the merge methods you're genuinely allowed to use.

[GitHub integration →](uxnandesktop/docs/github.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/create-pr.gif" alt="Filling in a pull request's title, description and draft switch from the GitHub dock" width="440" />

</td>
</tr>
<tr>
<td width="46%" valign="top">

### Read your history as a graph
A branch-graph gutter runs next to the commit log — click a commit to expand its changed files, click a file to open just that slice of the diff instead of one giant blob.

[Git, worktrees & diffs →](uxnandesktop/architecture/02c-git-worktrees.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/history-graph.gif" alt="Expanding a commit in the branch-graph history and opening one file's diff side by side" width="440" />

</td>
</tr>
<tr>
<td width="46%" valign="top">

### Spin up an isolated worktree in seconds
New branch, existing branch, or a custom location — every task gets its own worktree and its own agent, so nothing collides with whatever you're already running.

[Creating worktrees →](uxnandesktop/architecture/02c-git-worktrees.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/create-worktree.gif" alt="Creating a worktree on a new branch from the New worktree dialog, then finding it in the sidebar" width="440" />

</td>
</tr>
<tr>
<td width="46%" valign="top">

### Know your quota before it runs out
Session, weekly and monthly usage for Codex, Claude, Copilot and Grok, read straight from each CLI's own signed-in token — never a pasted key, never a cookie.

[Provider usage stats →](uxnandesktop/docs/providers.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/provider-usage.gif" alt="Opening the provider usage popover from the status bar, then the Providers settings" width="440" />

</td>
</tr>
<tr>
<td width="46%" valign="top">

### Review PRs, issues and CI in full screen
Open a project's Pull Requests, Issues and Actions in a focused view that replaces the center panel — approve, merge, comment or re-run a check without switching apps.

[GitHub integration →](uxnandesktop/docs/github.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/ci-pr-fullscreen.gif" alt="Opening a pull request from the dock, then its CI checks and its changed files" width="440" />

</td>
</tr>
<tr>
<td width="46%" valign="top">

### Watch subagents work under their parent
A subagent from Claude Code, Codex, Grok or OpenCode shows up live as a nested row under the agent that spawned it — with its kind and what it is working on — and the parent won't read "Done" while a child is still working.

[Agent hooks & precise states →](uxnandesktop/docs/agent-hooks.md)

</td>
<td width="54%" valign="top">

<img src="assets/shorts/agent-subagents.gif" alt="Claude Code launching two Explore subagents that appear nested under it in the sidebar" width="440" />

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
work required. The **22 below report precise state out of the box**: working /
blocked / waiting / done as it happens, plus session auto-resume, live model
discovery, and per-agent run options.

<p align="center">
  <kbd><img src="assets/agents/claudecode.svg" width="22" valign="middle" alt="" /> Claude Code</kbd>
  <kbd><picture><source media="(prefers-color-scheme: dark)" srcset="assets/agents/codex-on-dark.svg" /><img src="assets/agents/codex.svg" width="22" valign="middle" alt="" /></picture> Codex</kbd>
  <kbd><img src="assets/agents/opencode.png" width="22" valign="middle" alt="" /> OpenCode</kbd>
  <kbd><img src="assets/agents/cursor.png" width="22" valign="middle" alt="" /> Cursor</kbd>
  <kbd><img src="assets/agents/copilot.png" width="22" valign="middle" alt="" /> GitHub Copilot</kbd>
  <kbd><img src="assets/agents/droid.png" width="22" valign="middle" alt="" /> Droid</kbd>
  <kbd><img src="assets/agents/grok.png" width="22" valign="middle" alt="" /> Grok</kbd>
  <kbd><img src="assets/agents/amp.png" width="22" valign="middle" alt="" /> Amp</kbd>
  <kbd><img src="assets/agents/goose.png" width="22" valign="middle" alt="" /> Goose</kbd>
  <kbd><img src="assets/agents/qwen.png" width="22" valign="middle" alt="" /> Qwen Code</kbd>
  <kbd><img src="assets/agents/kiro.png" width="22" valign="middle" alt="" /> Kiro</kbd>
  <kbd><img src="assets/agents/auggie.png" width="22" valign="middle" alt="" /> Auggie</kbd>
  <kbd><img src="assets/agents/devin.png" width="22" valign="middle" alt="" /> Devin</kbd>
  <kbd><img src="assets/agents/kimi.png" width="22" valign="middle" alt="" /> Kimi</kbd>
  <kbd><img src="assets/agents/kilocode.png" width="22" valign="middle" alt="" /> Kilo Code</kbd>
  <kbd><img src="assets/agents/mimo.png" width="22" valign="middle" alt="" /> MiMo Code</kbd>
  <kbd><img src="assets/agents/commandcode.png" width="22" valign="middle" alt="" /> Command Code</kbd>
  <kbd><picture><source media="(prefers-color-scheme: dark)" srcset="assets/agents/openclaude-on-dark.svg" /><img src="assets/agents/openclaude.svg" width="22" valign="middle" alt="" /></picture> OpenClaude</kbd>
  <kbd><img src="assets/agents/pi.png" width="22" valign="middle" alt="" /> Pi</kbd>
  <kbd><img src="assets/agents/omp.png" width="22" valign="middle" alt="" /> OMP</kbd>
  <kbd><img src="assets/agents/zero.svg" width="22" valign="middle" alt="" /> Zero</kbd>
  <kbd><img src="assets/agents/antigravity.png" width="22" valign="middle" alt="" /> Antigravity</kbd><sup>*</sup>
</p>

<p align="center">
  <sub>*Antigravity's integration is partial — its headless CLI has no live approval channel, so it runs autonomously or in plan mode.<br />
  Zero has no hook surface; its state is read from the session it writes to disk.</sub>
</p>

These nine are in the catalog too. They launch, run and show a working / idle
indicator like anything else — their CLI simply exposes no way to say a turn
**ended**, so uxnan doesn't claim a precise state it cannot know. Point one at
the bundled wrapper and you get `working` on launch and `done` on exit.

<p align="center">
  <kbd><img src="assets/agents/aider.png" width="22" valign="middle" alt="" /> Aider</kbd>
  <kbd><img src="assets/agents/cline.png" width="22" valign="middle" alt="" /> Cline</kbd>
  <kbd><img src="assets/agents/continue.png" width="22" valign="middle" alt="" /> Continue</kbd>
  <kbd><img src="assets/agents/crush.png" width="22" valign="middle" alt="" /> Crush</kbd>
  <kbd><img src="assets/agents/codebuff.png" width="22" valign="middle" alt="" /> Codebuff</kbd>
  <kbd><img src="assets/agents/mistralvibe.png" width="22" valign="middle" alt="" /> Mistral Vibe</kbd>
  <kbd><img src="assets/agents/rovo.png" width="22" valign="middle" alt="" /> Rovo Dev</kbd>
  <kbd><img src="assets/agents/autohand.png" width="22" valign="middle" alt="" /> Autohand</kbd>
  <kbd><img src="assets/agents/ante.png" width="22" valign="middle" alt="" /> Ante</kbd>
  <kbd>+ any CLI agent</kbd>
</p>

<p align="center">
  <sub>Using one of these? If its CLI grows a hook surface, wiring it is a single table row —<br />
  see <a href="uxnandesktop/docs/agent-hooks.md">agent hooks</a>, and send a pull request.</sub>
</p>

<p align="center">
  Every one of them runs as that vendor's own official local CLI, under the account or<br />
  subscription you already signed it in with — uxnan doesn't call a provider API, hold a key,<br />
  or embed an SDK. It just drives the terminal, exactly like you would.<br />
  <b>Seven of them, Claude Code, Codex, OpenCode, Pi, Grok, Antigravity and Zero, also run as chats: in Uxnan Desktop and from your phone.</b>
</p>

---

## Uxnan Mobile — your agents, in your pocket

<!-- image added manually by the maintainer -->
<p align="center">
  <img src="assets/uxnan-mobile.png" alt="Uxnan Mobile: the PC it pairs with, a project's conversations, a new conversation offering to continue a session from this folder, a session held by a terminal on the PC with Continue here, and a finished answer with its work log" width="960" />
</p>

It's a real client, not a status page: conversations carry a **name the agent
wrote** rather than the first words you typed, they **stream in live** and survive
navigating away and back, a **message queue** lets you send follow-ups while an
agent is still working — reaching it *mid-turn*, without stopping it, on the
agents whose CLI allows that — you can attach **images**, pick the **agent and model**
per conversation, see protocol-confirmed **context compactions**, and keep every
native progress/final response without losing earlier text (settled progress folds
under **N previous messages**). You can also review and stage a **Git diff** and
get a **push notification** the moment an agent finishes, all over the same
end-to-end encrypted channel the bridge speaks. A new conversation can also
**continue a session from its folder**, one your agents had in a terminal or in
their own app, and a conversation open in a terminal on the PC offers **Continue
here**. Mobile offers the seven active agents shown above.

**Status: Android is alpha-ready.** iOS is written but not yet shipped — it's
waiting on Apple developer assets the project doesn't have yet.

### How it connects

Uxnan Mobile pairs with **`uxnan-bridge`**, a small daemon that runs on your PC on
its own, so you don't need Desktop installed at all to use Mobile, or the other
way around. If you do use Uxnan Desktop, it talks to the same bridge: its Bridge
window shows the pairing QR, lists your phones, and installs or updates the
bridge for you.

```bash
npm install -g uxnan-bridge
uxnan-bridge start
```

That boots the daemon and prints the pairing QR right there in the terminal.
Scan it from the app (or type the short code it prints) and you're paired. The
phone connects **directly** over your LAN or Tailscale first. To reach your PC
from any other network without a VPN, the bridge can deploy **your own relay**
into your free Cloudflare account (`uxnan-bridge relay setup`) — nothing is
hosted by uxnan. Either way, every byte is sealed end-to-end before it leaves
your phone. How to pick: **[connecting your phone](docs/connecting.md)**; full
setup in **[bridge/README.md](bridge/README.md)**.

---

## Install

### Uxnan Desktop

Grab the latest release for your platform from
**[GitHub Releases](https://github.com/luisgamas/uxnan/releases/latest)**:

| Platform | What to grab |
|---|---|
| Windows | the `.msi`, or the NSIS `_x64-setup.exe` installer |
| macOS *(experimental, unsigned)* | `_x64.dmg` (Intel) or `_aarch64.dmg` (Apple Silicon) |
| Linux | `.deb`, `.AppImage`, or `.rpm` — glibc 2.35 or newer (Ubuntu 22.04, Debian 12 and later) |

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

### The bridge (for Mobile, and for Desktop's chats)

```bash
npm install -g uxnan-bridge
```

See **[bridge/README.md](bridge/README.md)** for the full CLI, autostart, and
per-agent sign-in prerequisites.

---

## Security

Every byte between your phone and your PC is sealed end-to-end — an X25519 key
exchange, Ed25519-signed identities, and AES-256-GCM encryption; your optional
relay, which runs in your own Cloudflare account, only ever sees sealed
envelopes, never your code. GitHub actions route
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
[`relay/`](relay/README.md) · [`shared/`](shared/README.md) · [`web/`](web/README.md).

## License

Uxnan is released under the [Mozilla Public License 2.0](LICENSE).
