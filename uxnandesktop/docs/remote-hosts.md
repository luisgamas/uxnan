# Remote hosts over SSH

> **Status: usable, with gaps that are named.** Connecting, terminals, running an
> agent, browsing folders, adding a project, the Files tab — listing, opening and
> **saving** — Changes and History, and now **the host's ports**, brought here
> and previewed, all work on a host today. What does not: GitHub — it reads this
> machine's repository and its `gh` sign-in. This page says which is which, and
> is updated by the change that lands each piece.

## The idea

A remote host is another machine of yours that the ADE connects to over SSH.
**The interface stays here; the work happens there.** Agents run on the host,
using the CLIs that host has installed and the credentials that host is logged
in with. Your terminal, your git panel and your file tree are just looking at
another machine.

That is the arrangement every mature remote development client converges on, and
it is not the same as "run my local agent against remote files": an agent runs
build commands, tests and git through its own shell tool, so if the binary lived
here, all of that would execute here — against a network mount — which is the
opposite of why anyone reaches for a bigger machine.

**What this means for agents and logins:** each host has its own agent CLIs and
its own provider sessions. You log a CLI in once per host, from a terminal in
the app. If a host is missing an agent you want, the app will tell you and offer
the install command rather than pretending it is there.

## Trust

An SSH host is **"my machine, my account"**. An SSH session is worth exactly what
your shell on that host is worth, so the app does not claim to fence you into a
reduced set of permissions on the far side — that would be a different design,
and claiming it here would be false.

What the app *does* guarantee is that an operation lands on the machine you meant
it for. Every mutation carries the target it was prepared for, and the backend
refuses it — before anything runs — if that no longer matches.

## Secrets

**None are written.** A host record holds an alias, hostname, port, user and a
*reference* to an identity file. Never a key, never a password. Those come from
the agent your SSH configuration names, from the key file on disk, or from what
you type when the app asks.

What you type — a password, a key passphrase — is kept **in memory until you
close the app**, so a dropped connection (a laptop lid, a Wi-Fi handover) can
come back on its own instead of asking again. It is never written anywhere, never
logged, and wiped from memory when replaced. A wrong one is forgotten at once, so
the next attempt asks rather than replaying it. Answers to a second factor (a
one-time code) are never kept at all: they cannot be reused.

For git operations on the remote host, use **`ForwardAgent`**: it lets git over
there use the keys held by the agent over here, without a private key ever
leaving this machine. Set it in your SSH config or in the host's form; the app
asks the host to forward the agent on every terminal and command it opens there,
and accepts the host's agent requests only on a connection that asked for them.
Anyone with root on that host can use the forwarded agent while you are
connected — enable it for machines you trust.

## Your SSH configuration — works today

The app reads `~/.ssh/config` so adding a host is picking one from a list rather
than retyping what you already wrote:

- **Listing aliases** follows `Include` (relative, absolute, `~/…` and globs),
  handles both `Host name` and `Host=name`, several aliases on one line, and
  survives an include cycle. Wildcard patterns like `Host *` are skipped — those
  configure defaults, they are not hosts you connect to. If you have no config
  file, the list is simply empty.
- **Resolving a host** shells out to **`ssh -G`** rather than interpreting the
  file ourselves. OpenSSH's own precedence rules (`Match` blocks, pattern order,
  canonicalization) are subtle enough that a hand-written parser eventually
  connects somewhere your own `ssh` would not. `ssh -G` ships with Windows, macOS
  and Linux, and prints exactly what OpenSSH would use.

**It is resolved at every connect**, not once when the host is added: edit your
config and the next connection uses the change, as it would for `ssh`. A host you
typed by hand is resolved the way the matching command line would be
(`ssh -p 2222 -l dev -J bastion box`), so it still picks up your `Host *`
defaults — the agent socket, the known-hosts files, `IdentitiesOnly`. An
imported host shows a snapshot of what it resolved to; only its label is edited
in the app, because the rest comes from the file.

What the app acts on:

| Setting | What it does here |
|---|---|
| `HostName`, `Port`, `User` | where and as whom |
| `IdentityFile`, `CertificateFile` | keys to offer, with their certificate (also `<key>-cert.pub`) |
| `IdentityAgent` | which agent to ask — a socket path, `SSH_AUTH_SOCK`, or `none` for no agent |
| `IdentitiesOnly` | offer only the configured keys, even when the agent holds others |
| `ForwardAgent` | forward the agent to the host (above) |
| `ProxyJump` | reach the host through one or more bastions — see below |
| `ProxyCommand` | let a command carry the connection (`%h %p %r %n %%` expanded) |
| `HostKeyAlias` | the name the host key is filed under |
| `UserKnownHostsFile`, `GlobalKnownHostsFile` | where host keys are read (and the first user file, where they are written) |
| `StrictHostKeyChecking` | what happens with a key that is not on file — see *Host keys* |

OpenSSH prints the literal `none` for `ProxyCommand`, `ProxyJump` and
`HostKeyAlias` when they are unset, and the app treats that as "not configured".
`IdentityAgent none` is kept: there it means *use no agent*.

### Bastions (`ProxyJump`)

A host behind a jump host is reached the way `ssh -J` reaches it, inside the
app: the bastion is an SSH connection of its own — its own key check, its own
login — and the host is a full SSH session carried in a tunnel the bastion opens
to it. That is why a name only the bastion can resolve works. Chains
(`ProxyJump a,b`) and bastions with a `ProxyJump` of their own are followed, with
a loop check. When a bastion asks for something — a password, a code, a key to
trust — the dialog names it: *"edge (on the way to build-box)"*. A bastion's
password is offered to that bastion only.

## How you authenticate

**You can just use a password.** If the host accepts one — most do out of the box
— there is nothing to set up on the far machine: no key to generate, nothing to
append to `authorized_keys`. The app asks for the password and connects. Setting
up a key later is a convenience so you stop typing it, not a prerequisite.

The app starts by asking the server what it accepts, so it never offers keys to a
host that does not take them, and never tells you "authentication failed" when
the truth is "this machine wants a password and nobody asked you for one". If a
key of yours is refused on a host that also takes passwords, you get told both
things: which key was refused, and that you can try a password.

Keys are offered in the order that interrupts you least:

1. keys your config names **that the agent already holds** — unlocked once,
   usable everywhere;
2. keys your config names that open without asking (not encrypted, or unlocked
   earlier in this session);
3. every other key the agent holds — unless `IdentitiesOnly yes`;
4. only then an encrypted key nobody has unlocked: the app **asks for its
   passphrase**, and says so if the one you typed did not open it.

Asking last means a working agent never causes a passphrase prompt. Key paths in
your config that do not exist on disk are skipped rather than attempted, because
OpenSSH lists its defaults whether or not you have them. On Windows the agent is
OpenSSH's agent service; elsewhere it is whatever `SSH_AUTH_SOCK` — or your
`IdentityAgent` — points at.

**Second factors work.** A server that asks more than a password over
keyboard-interactive — a one-time code, a hardware-token prompt — gets its
questions shown to you exactly as it sent them, with typing visible where the
server allows it (a code) and hidden where it does not. The connection waits
while you answer, and a server that needs a key **and** a code (`partial
success`) is carried through both steps instead of reporting the key as refused.
A single hidden "Password:" prompt is answered with the password you already
gave.

## Host keys — the rules the app connects under

The confirmation is in the app (Settings → Hosts asks you before trusting a key
it has never seen), and the decision behind it is verified against a real SSH
server on every test run. The rules:

- **A key already in `known_hosts`** → connects.
- **A host you have never seen** → the app asks you, showing the `SHA256:…`
  fingerprint to compare, and **writes nothing** until you confirm. Under
  `StrictHostKeyChecking yes` it shows the fingerprint and offers nothing: your
  configuration says such keys are added by hand. Under `accept-new` (or `no`)
  a new key is recorded without asking, and the log says so.
- **A host whose key changed** → refused, showing both fingerprints, and no
  credential is sent. If you know the machine was reinstalled, the dialog offers
  **"The machine was reinstalled — replace the key"**: the old entries for that
  name, port and key type are taken out of your own `known_hosts` (backed up first
  to `known_hosts.old`, as `ssh-keygen -R` does) and the presented key is
  recorded. A stale entry in a system-wide file cannot be replaced from here.
  No setting lets a changed key through on its own.
- **`@revoked`** → refused, and never offered for trust.

An unverified host is **never connected to, not even to ask you**: the handshake
is refused, and only after you confirm does the app connect again with the key
recorded. Asking after connecting would mean an impostor had already been talked
to. The handshake also asks the server for the key **types already on file**
first, so an impostor cannot dodge the check by presenting a type that has no
entry and passing as a new host.

The fingerprint the app shows is the same string OpenSSH shows, so you can
compare it against `ssh-keygen -lf` or what the host's administrator gave you —
that equivalence is asserted by the test suite, because a fingerprint that
differed by so much as its padding would make the comparison you are being asked
to do worthless.

There is **no "ignore host key" mode**, and there will not be one behind a
setting. Non-default ports use OpenSSH's `[host]:port` form, so trusting a key on
one port does not trust it on another; hashed files (`HashKnownHosts yes`) are
matched properly, so your hosts do not all look new; and `@cert-authority` lines
are skipped rather than mistaken for a host's own key.

### Troubleshooting

**"`ssh -G` failed."** Run the same command yourself:

```powershell
ssh -G myhost
```

If that fails, the app cannot resolve the alias either — fix the config entry
first. The app deliberately does not guess a hostname from the alias.

**An alias is missing from the list.** Check it is not behind a wildcard pattern
and that the file declaring it is reachable from your main config through
`Include`. Only `Host` and `Include` lines are scanned.

## Which machines this works with

**Linux, macOS, Windows and WSL.** Linux is the one that is *checked*: the test
suite drives the whole remote stack against a real `sshd` in a container on every
change to this layer (`docs/testing.md`). Windows is what this is developed
against day to day. macOS should work — it takes the same POSIX path Linux does —
but nobody has run it, and this page will say so until someone has.

A project's files and git are served by the **host engine** (below); the folder picker
and installing the engine itself go over **SFTP**, a subsystem, so they behave
identically everywhere. What still needs a shell
(asking what is installed, and which ports it listens on) is sent in the dialect
**the host itself reported** when it connected, never in one guessed from what it claims to be:

| Host | How it is driven |
|---|---|
| Linux, macOS | a POSIX login shell (`sh -lc`) — `-l` matters, because without it the PATH is the non-interactive one and nvm/mise/fnm are missing, which is the most common reason a CLI that is installed looks like it is not |
| Windows | PowerShell with `-NoProfile -NonInteractive`, sent as `-EncodedCommand` |
| WSL | the POSIX branch, whether you reach the distro's own `sshd` or the Windows host launches `bash` |
| Windows with a POSIX shell configured in `sshd` | answers the POSIX probe and is treated as POSIX — which is correct |

**Your login shell is yours.** uxnan does not require a particular one and does
not need to be told: on connecting it runs one probe whose reply identifies the
family, and anything it later types into a terminal — the `cd` that puts you in
your project's folder — is written in that shell's own syntax. Switch the machine
between cmd, PowerShell, WSL and Git Bash as you like; the next connection asks
again. If the reply is not recognisable, uxnan types nothing and the terminal
simply opens where your shell starts, which is the honest outcome rather than a
terminal that dies on syntax.

The PowerShell script is base64-encoded on purpose. Whatever your `sshd` is
configured to launch — `cmd`, `powershell`, `pwsh` — sees the command first, and
each treats quotes and backslashes differently; an encoded payload leaves it
nothing to reinterpret.

**It never names a shell for you.** If your host starts PowerShell, the script
runs in *that* PowerShell, whichever version you have — the app does not start a
second one. Only a host running `cmd` needs an interpreter named, and there it
asks for `pwsh` first and falls back to Windows PowerShell. To read one back while debugging:

```powershell
[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('<the base64>'))
```

## Adding a project that lives on a host

Settings → **Hosts** → the host → **Add a project**. The picker is the one you
already use for local projects — address bar, ↑/↓ navigation, repository badges,
a per-row **Add**, `Ctrl`/`⌘`+`Enter` to add the folder you are in — pointed at
the other machine. Two differences, both real rather than cosmetic:

- **Navigation is as quick as the file tree**, because it goes the same way: over
  SFTP, not by asking the host's shell to list a folder. The picker does not
  watch the folder it shows — the refresh button is the reload.
- **A very large folder comes back cut**, and the picker says so rather than
  quietly showing the first few hundred entries.
- **A host with the `sftp` subsystem disabled cannot be browsed.** The file tree
  already required it, so such a host was of little use anyway; it is said here
  rather than discovered.

The project is registered against the host it lives on, so the same absolute path
on two machines is two different projects, and mutations verify they are acting on
the machine you meant.

### What a host's project does, and does not, do yet

Select it in the left panel and:

| | |
|---|---|
| **Terminals** | Open on the host, in the project's folder, in your **login** shell there (so the `PATH` a version manager writes into your profile is there too). Splits and further terminals stay there too. On a Linux, macOS or Windows host they live in the **host engine** (below) and outlive a dropped connection and an app restart; elsewhere they are a channel on the connection and end with it. |
| **Files** | **Works — including saving and searching**, on a host where the **host engine** runs (below). The engine serves the project's files with the same code the app runs on its own disk, so the tree lists them (git-ignored files dimmed, as here), opens and previews them (images and PDFs up to 25 MiB), saves them (atomically, keeping the file's permissions), and **creates, renames, duplicates and deletes** them — on that machine, and fenced like every other change: refused outright if the host or its connection has moved on, since the same absolute path usually exists on both machines. **Deleting there is permanent**: a host has no trash, so the dialog promises what will actually happen instead of offering to "move to trash". **Searching** by file name and by content walks the project *there*, following the same `.gitignore` rules as here, whether or not it is a repository — the results come back, the files never do. A host where the engine cannot run has no project files, and the panel says so; its terminals still work. The menu items only this machine can carry out (reveal in the file manager, open with a local editor, add as a local project) are not offered for a host's entry. If you open the app before connecting, the panel says it is waiting and fills in by itself once the host is up. |
| **Branch and change count** | **Works.** The row shows the branch the host is on, how many files changed and how far it is from its upstream — read by the host engine running git *there*. If the host cannot answer (no engine, no git, not a repository), the badges stay empty rather than showing zeroes that would read as "clean". |
| **Changes** | **Works.** The changed-file list, per-file and per-hunk diffs, staging, discarding, committing, and fetch/push/pull — all run by the host engine with git *on the host*, the same git code the app runs here. Anything that changes the host names the machine and connection it was prepared for, and is refused outright if either has moved on — the same absolute path usually exists on both machines, so a misrouted discard is the failure that would look like success. **Push and pull use your forwarded agent**: with `ForwardAgent` on, the engine follows the agent of your latest connection, so a push over SSH signs with the keys you hold here. Image diffs work too — the picture's bytes travel as bytes — and the **AI commit draft** reads the staged diff on the host and runs your agent here, where its CLI and sign-in are. |
| **History** | **Works.** The log, the branch graph, a commit's file list and its patch, read on the host. |
| **Worktrees** | **Works.** A project on a host lists its worktrees, creates new ones (a new or existing branch, a base, an optional folder of your own) and removes them with the same optional branch cleanup — all done by the host engine with the same placement rules as here. They land under the host's own `~/uxnan/worktrees`; the global custom root in Settings is a folder on *this* machine, so on a host only a project's own root applies. Creating and removing are refused while the host is disconnected. |
| **GitHub** | **Not available.** It reads this machine's repository and its `gh` sign-in, so the panel says which host the project lives on instead of describing the wrong repository. |
| **Ports** | **Works.** A dev server you start on the host shows up in the status-bar ports indicator as soon as it prints its address — that costs nothing and needs nothing installed there, because it is the server talking rather than the machine being asked. For anything that announces nothing (or was already running), the refresh button asks the host what it is listening on; that one runs a command there, which is why it is a button and not a poll. **Open** brings the port to `127.0.0.1` over the connection the host already has and opens the preview where your browser setting says. The tunnel listens on loopback only — never the wildcard, which would republish your host's dev server to the whole network — and keeps the same port number when it is free, saying which one it used when it was not. A port that cannot be reached is reported **before** the preview opens, with the difference SSH itself makes: *that host does not allow port forwarding* (an `sshd` setting its owner can change) versus *nothing answered there* — a browser error page cannot tell you which. If the scan found the service pinned to one address of that machine (a VPN or LAN interface, which does not answer on its own `127.0.0.1`), the tunnel is aimed at that address instead. Nothing is forwarded until you ask, and disconnecting a host closes its tunnels. |
| **Automatic refresh** | **Yes, on a host with the engine (Linux, macOS, Windows).** The host engine watches the project folder **there** and says what changed, so the file tree, the open tabs and Changes follow an agent working in that folder or a `git` command in a terminal there — a commit or a stage included — with nothing asked of the host and nothing polled. Changes waits for a burst (a build, a checkout) to settle and reads the host once. Without the engine (a host it cannot run on), only what uxnan itself does refreshes by itself — discarding a change or a hunk, pulling — and the rest refreshes when you open a panel, when you act, and on the refresh button: polling the host every 3 seconds at about two seconds a command is not something to do to someone's machine. |

The card carries the host's name, and its terminal count includes the terminals
open on that machine.

### At startup

Hosts that let uxnan in **without asking for anything** are reconnected on their
own when the app starts, so a project on one of them has its files, its branch
and its terminal without you opening Settings first. A host that asked for a
password, a key passphrase or a code last time is *not* reconnected
automatically — a stack of credential prompts at launch is not a greeting;
connect it when you want it. Nor is one with a key not yet on file, on itself or
on any bastion of its route: that can only end in the trust dialog.

Once you have connected one, though, a dropped connection **does** come back on
its own within the session — the reconnect steps (2, 5, 15, 30, 60 s) reuse the
password or passphrase you typed, which the app holds in memory until it closes.
A host that needed a one-time code is the exception: a code cannot be replayed,
so it waits for you.

### When something on the host goes away

A connection to a host carries several channels — one per terminal, one for
files, one per command — and any of them can end on its own while the rest keep
working. So:

- **The file channel** is replaced the next time you use it, without asking. You
  may notice a folder taking a moment; you should not see an error about it.
- **A connection that has ended stops counting as connected**, so the host shows
  as disconnected and **Connect** genuinely reconnects it. (Before, the app kept
  saying "connected" and Connect did nothing, because a session was already on
  file.)
- **Terminals in the host engine keep running.** The tab says, in one dim line,
  that the connection was lost and the terminal keeps running there; when the
  host is back the terminal is repainted with what it shows now and carries on.
  Nothing is retyped into it — an agent that was working is still working. Only
  if the host's daemon itself went away in between (the machine rebooted) does
  the tab report that the terminal ended.
- **Terminals on a plain channel** (a host the engine cannot run on — see
  *Where it does not run* below) end with the connection, and the program in them on
  the host. An agent's tab keeps what it showed and offers to resume the session;
  a plain shell's tab closes. A terminal that could not *start* because its host
  was away starts by itself once the host connects.
- **The file tree empties itself** and says it is waiting, instead of leaving the
  folders of a machine that is no longer there on screen. It fills back in when
  the host returns.
- **Changes and History do the same.** What was read stays true of the moment it
  was read, but nothing can be sent to a machine that is gone, so every action is
  disabled while it is away — and the commit message you were writing is left
  alone, since the host coming back makes it usable again.
- **Running out of channels says so, and says what is holding them.** Every
  terminal, the file panel and each running command is a channel on the one
  connection, and your host caps how many it carries at once (OpenSSH's
  `MaxSessions`, 10 by default). uxnan does not assume that number — it learns it
  the first time your machine refuses. When that happens you have three ways out:
  close a terminal on that host, **disconnect it in Settings → Hosts and connect
  again** (which frees every channel at once), or raise `MaxSessions` in its
  `sshd` configuration.

  Note what this does *not* do: closing a terminal ends its shell, but a program
  that shell left running on the host keeps running, and uxnan cannot see it —
  the resource monitor walks *this* machine's processes. To find those, look on
  the host itself (a terminal there, `ps` / Task Manager).
- **A host that goes away is noticed in about two minutes.** uxnan asks each
  connected host every 30 seconds whether it is still there and gives up after
  three unanswered asks — the same thing mature SSH clients do, and the reason a
  connection nobody is typing at no longer gets dropped for being quiet (it used
  to be reaped after five minutes of silence).

## Terminals that outlive the connection: the host engine

On a Linux, macOS or Windows host, the app runs a small program of its own
there — the **host engine**, `uxnan-host` — that owns the terminals instead of
the SSH session, and serves the project's files. That is what lets a terminal, and the agent in it, survive a closed
laptop lid, a Wi-Fi handover or an app restart.

- **Nothing to install by hand.** The first terminal on a host uploads the
  engine over the SFTP session the host already has, into
  `~/.uxnan/host/versions/` (a folder only your account can read),
  and asks it to prove it runs there. It is one static binary — no Node, no
  compiler, nothing downloaded on the host itself — so a server without Internet
  access works too. Each build gets its own folder
  (`~/.uxnan/host/versions/<version>-<hash>/`), so an update never replaces the
  program a running engine was started from.
- **One channel for all of them.** Every terminal on the host travels over one
  SSH channel, so they no longer count one by one against the host's
  `MaxSessions`.
- **The project folder is watched there.** The tree, the open tabs and Changes
  refresh by themselves when anything changes in the folder on the host (see
  *Automatic refresh* above).
- **Agents there report their state.** With auto-install on, connecting wires
  the agents the host has (the same reporters as here, registered in their
  configs there) and their terminals report to the engine, which hands each
  report to the tab it came from — the same cards, checks and notifications as
  a local agent, also after the lid was closed. See
  [agent hooks → Agents on an SSH host](./agent-hooks.md#agents-on-an-ssh-host).
- **Agents there use this app's tools.** The control surface's MCP tools and
  the integrated browser reach a host's agents through the engine, as the tab
  that shows them — a `localhost` link there opens here through a forward. See
  [browser](./browser.md).
- **A silent link is noticed in seconds.** The app checks on the engine every
  10 seconds; if nothing has come back for 30, the link is treated as gone — the
  tabs say so and the host is reconnected — instead of waiting the two minutes
  the SSH keepalive takes to reach the same verdict on a Wi-Fi that dropped
  without a word.
- **The screen comes back, not the bytes.** The engine keeps what each terminal
  shows; a returning tab is repainted from that — a full-screen agent included —
  and live output resumes after it. After an app restart the tab also gets what
  had scrolled above the screen (up to 2,000 lines, with their colours) in its
  own scrollback; after a dropped connection it keeps the history it had, so
  nothing is printed twice.
- **A restart finds its terminals.** A tab is matched to its terminal by its
  persistent session id, so reopening the app reattaches to the terminal it had
  instead of opening a second one — and does not launch the agent again.
- **Closing a tab ends its terminal there** — immediately, or as soon as the host
  is reachable again if it was not.
- **An app update does not strand terminals.** The app and the engine meet in a
  protocol window rather than on an exact version: an updated app talks to the
  engine that holds the host's terminals, whichever build it is, and a newer
  engine takes over only once the older one has nothing left to do. A feature
  the older engine lacks (watching, for one) simply waits for it.
- **It does not linger.** With no terminal running and nobody attached, the
  engine exits on its own after 30 minutes. Nor do old builds: an engine that
  starts removes the builds of earlier versions that nothing runs from any more
  (a build in use, or uploaded in the last 10 minutes, stays). Its log (`~/.uxnan/host/host.log`)
  records lifecycle only — never what a terminal showed or what was typed.

**Where it runs:** Linux, macOS and Windows hosts, each on x86-64 and ARM —
every installer carries all six builds, whatever machine the app itself runs on.
On Windows the engine listens on a named pipe only your account can open, and is
started outside the SSH session's job, so closing the connection does not end it.
Proven against a Windows host whose `sshd` starts `cmd` (the CI runner reaching
its own OpenSSH Server).

**Where it does not run:** a host with no build (32-bit ARM, i686, the BSDs), a
home folder mounted `noexec`, or a server that will not run an uploaded program.
There a terminal is a **plain channel on the session**: it works, and it ends
with the connection — the one place the app keeps that older kind of terminal,
because a host must always give you a shell. For development builds, see
[Development → the host engine](./development.md#the-host-engine).

## From a shell, without the app window

`uxnan-cli` reaches the same sessions, which is handy when the machine you care
about is not the one you are looking at:

```
uxnan-cli host ls                 # every host, connected or not, with its channels
uxnan-cli host show build-box     # plus the projects and terminals on it
uxnan-cli host connect build-box  # open a session on one that has none
```

`connect` never asks for anything secret. A host that wants a password or a key
passphrase you have not given in this session of the app answers
`needsPassword` / `needsPassphrase` and stops; one that wants a second factor
answers `needsAnswers`; one whose key is unknown or has changed answers that and
stops too, having trusted nothing. Any of them can be about a bastion on the
way, and a `ProxyCommand` that cannot run answers `proxyFailed`.
Those are yours to finish in Settings → Hosts — and adding, editing or removing
a host has no command at all, for the same reason. The agents uxnan launches do
**not** see this: their token is scoped to one project, so hosts are the
person's shell's to ask about (see
[the control surface](./control-api.md) → *Hosts*).

## Not planned

- **Containers and devcontainers** as a feature of their own. An environment you
  declare yourself that prints an SSH destination comes in through the same door
  as any host.
- **A sandbox of our own.** Each agent CLI brings its own isolation or none at
  all — and on native Windows most of them bring none — so the app cannot promise
  a uniform boundary without lying about it. Where an agent has one, the app's
  job is to expose and explain it.

## What is coming

In order: handing a host agent's session over to a chat (the host's own
bridge), and reaching a host through the system's own `ssh`.

Deliberately *not* coming: any mode that skips host-key verification.

Architecture: [`architecture/02g-remote-hosts.md`](../architecture/02g-remote-hosts.md).
Execution-target identity and mutation fencing:
[`architecture/02a-system-architecture.md`](../architecture/02a-system-architecture.md) §2.9.
