# Remote hosts over SSH

> **Status: under construction.** Reading your SSH configuration works today.
> Connecting, running agents on a host and everything built on top of that is
> still being implemented — this page says which is which, and is updated with
> the change that lands each piece.

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

## Host keys — the rules the app will connect under

Not reachable from the UI yet (there is nothing to connect to), but the decision
logic is in place and these are the rules it enforces:

- **A key already in `known_hosts`** → connects.
- **A host you have never seen** → the app asks you, showing the `SHA256:…`
  fingerprint to compare, and **writes nothing** until you confirm.
- **A host whose key changed** → refused, showing both fingerprints. This is a
  separate outcome from "never seen", deliberately: collapsing the two is how a
  man-in-the-middle gets waved through.
- **`@revoked`** → refused, and never offered for trust.

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

## Not planned

- **Containers and devcontainers** as a feature of their own. An environment you
  declare yourself that prints an SSH destination comes in through the same door
  as any host.
- **A sandbox of our own.** Each agent CLI brings its own isolation or none at
  all — and on native Windows most of them bring none — so the app cannot promise
  a uniform boundary without lying about it. Where an agent has one, the app's
  job is to expose and explain it.

## What is coming

In order: connecting (host registry, authentication, host-key verification,
reconnect), the host inventory that reports which agents are actually there, the
remote terminal and launching an agent on it. Then precise agent status, remote
files/git/worktrees, forwarded ports with preview, and session continuity.

Architecture: [`architecture/02g-remote-hosts.md`](../architecture/02g-remote-hosts.md).
Execution-target identity and mutation fencing:
[`architecture/02a-system-architecture.md`](../architecture/02a-system-architecture.md) §2.9.
