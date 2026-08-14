# Remote hosts over SSH

> **Status: usable, with gaps that are named.** Connecting, terminals, running an
> agent, browsing folders, adding a project, and the Files tab — listing, opening
> and **saving** — all work on a host today. What does not: Changes, History and
> GitHub (they still read this machine's git), searching a host's tree, and
> creating/renaming/deleting from the tree. This page says which is which, and is
> updated by the change that lands each piece.

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

**None are stored.** A host record holds an alias, hostname, port, user and a
*reference* to an identity file. Never a key, never a password. Those come from
your system's ssh-agent, from the key file on disk, or from a prompt that lives
in memory for that session only.

For git operations on the remote host, use **`ForwardAgent`**: it lets git over
there use the keys held by the agent over here, without a private key ever
leaving this machine. The app reads the setting from your SSH config and honors
it per host.

## Your SSH configuration — works today

The app reads `~/.ssh/config` so adding a host is picking one from a list rather
than retyping what you already wrote:

- **Listing aliases** follows `Include` (relative, absolute, `~/…` and globs),
  handles both `Host name` and `Host=name`, several aliases on one line, and
  survives an include cycle. Wildcard patterns like `Host *` are skipped — those
  configure defaults, they are not hosts you connect to. If you have no config
  file, the list is simply empty.
- **Resolving one alias** shells out to **`ssh -G <alias>`** rather than
  interpreting the file ourselves. OpenSSH's own precedence rules (`Match`
  blocks, pattern order, canonicalization) are subtle enough that a hand-written
  parser eventually connects somewhere your own `ssh` would not. `ssh -G` ships
  with Windows, macOS and Linux, and prints exactly what OpenSSH would use.

What is read from the resolved output: hostname, port, user, identity files,
`IdentityAgent`, `IdentitiesOnly`, `ForwardAgent`, `ProxyCommand` and
`ProxyJump`. OpenSSH prints the literal `none` for the last three when they are
unset, and the app treats that as "not configured" — otherwise it would try to
run a proxy command called `none`.

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

When you do have keys, the app tries your **ssh-agent first**, then the identity
files your SSH config points at for that host. The agent goes first on purpose: it holds keys you have
already unlocked, so connecting to five hosts does not mean five passphrase
prompts. On Windows that is OpenSSH's agent service; elsewhere it is whatever
`SSH_AUTH_SOCK` points at.

If a key file is encrypted and the app has no passphrase for it, it **asks you
for that key** rather than reporting a failure — "wrong key" and "I could not
open your key" are different problems, and telling you the first when it is the
second sends you off to debug the wrong thing. Key paths in your config that do
not exist on disk are skipped rather than attempted, because OpenSSH lists its
defaults whether or not you have them.

Nothing you type is stored: a passphrase lives in memory for one attempt. The
app records the *path* to a key, never the key.

## Host keys — the rules the app connects under

The confirmation is in the app (Settings → Hosts asks you before trusting a key
it has never seen), and the decision behind it is verified against a real SSH
server. The rules:

- **A key already in `known_hosts`** → connects.
- **A host you have never seen** → the app asks you, showing the `SHA256:…`
  fingerprint to compare, and **writes nothing** until you confirm.
- **A host whose key changed** → refused, showing both fingerprints. This is a
  separate outcome from "never seen", deliberately: collapsing the two is how a
  man-in-the-middle gets waved through.
- **`@revoked`** → refused, and never offered for trust.

An unverified host is **never connected to, not even to ask you**: the handshake
is refused, and only after you confirm does the app connect again with the key
recorded. Asking after connecting would mean an impostor had already been talked
to.

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

**Linux, macOS, Windows and WSL.** Most of what the app does on a host needs no
shell at all — files, the folder picker and the tree go over **SFTP**, a
subsystem, so they behave identically everywhere. What genuinely needs a shell
(git, and asking what is installed) is sent in the dialect **the host itself
reported** when it connected, never in one guessed from what it claims to be:

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
  SFTP, not by asking the host's shell to list a folder. There is still no
  filesystem watch — the refresh button is the reload.
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
| **Terminals** | Open on the host, in the project's folder — a channel on the connection that host already has. Splits and further terminals stay there too. |
| **Files** | **Works — including saving.** The tree lists, opens and saves files on the host over SFTP — an SSH subsystem, so it behaves the same whatever shell your host runs, and nothing has to be installed there. A save writes the file **in place** (keeping its permissions and owner) and then asks the host how big it ended up, so a partial write is reported instead of looking like success; saving is refused outright while the host is disconnected. Gaps that remain: no search (it walks *this* filesystem, so the action is hidden rather than offered broken), no git-ignored dimming, no automatic refresh — the refresh button is the reload — and creating, renaming or deleting from the tree is still local-only. The Changes view is not offered on a host because there is no remote diff yet. If you open the app before connecting, the panel says it is waiting and fills in by itself once the host is up — and if the host later ends the file channel, the next click opens a new one instead of leaving the panel stuck (see below). |
| **Branch and change count** | **Works.** The row shows the branch the host is on, how many files changed and how far it is from its upstream — read by running git *there*, through the shell that machine reported. If the host cannot answer (no git, not a repository), the badges stay empty rather than showing zeroes that would read as "clean". |
| **Changes, History, GitHub** | **Not available.** The diff, staging and history still read this machine's git, so the panel says which host the project lives on instead of describing the wrong repository. |
| **Automatic refresh** | **No.** The watcher that keeps a local project's panels live polls every 3 seconds, and one remote command costs about two — so a host's panels refresh when you open them, when you act, and on the refresh button. Said out loud rather than faked. |

The card carries the host's name, and its terminal count includes the terminals
open on that machine.

### At startup

Hosts that let uxnan in **without asking for anything** are reconnected on their
own when the app starts, so a project on one of them has its files, its branch
and its terminal without you opening Settings first. A host that asked for a
password or a key passphrase last time is *not* reconnected automatically — a
stack of credential prompts at launch is not a greeting; connect it when you want
it. Nothing is stored either way: the prompt lives in memory for that attempt
only.

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
- **Terminals** whose channel ended say so in the tab; they restart when their
  host connects again.
- **The file tree empties itself** and says it is waiting, instead of leaving the
  folders of a machine that is no longer there on screen. It fills back in when
  the host returns.
- **A host that goes away is noticed in about two minutes.** uxnan asks each
  connected host every 30 seconds whether it is still there and gives up after
  three unanswered asks — the same thing mature SSH clients do, and the reason a
  connection nobody is typing at no longer gets dropped for being quiet (it used
  to be reaped after five minutes of silence).

## Not planned

- **Containers and devcontainers** as a feature of their own. An environment you
  declare yourself that prints an SSH destination comes in through the same door
  as any host.
- **A sandbox of our own.** Each agent CLI brings its own isolation or none at
  all — and on native Windows most of them bring none — so the app cannot promise
  a uniform boundary without lying about it. Where an agent has one, the app's
  job is to expose and explain it.

## What is coming

In order: **Changes and History** on a host (per-file diff, staging, commit and
the log), **searching** a host's tree, and **creating, renaming and deleting**
from it. Then precise agent status on a host (it needs a reverse tunnel and
reporters installed there), forwarded ports with preview, and session continuity.

Two things deliberately *not* coming: a helper program installed on your machines
— every piece that moved off the shell removed its reason to exist, and it would
add a class of failure ("could not install the server on your host") that this
does not have today — and any mode that skips host-key verification.

Architecture: [`architecture/02g-remote-hosts.md`](../architecture/02g-remote-hosts.md).
Execution-target identity and mutation fencing:
[`architecture/02a-system-architecture.md`](../architecture/02a-system-architecture.md) §2.9.
