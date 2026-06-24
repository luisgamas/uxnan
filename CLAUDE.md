# Uxnan — Claude Code entry point

**Single source of truth: [`AGENTS.md`](AGENTS.md).** Keep every rule, convention
and status note there — not here. This file exists only so Claude Code loads those
guidelines automatically: Claude Code reads `CLAUDE.md` at the start of every
session and resolves the `@`-import below by inlining `AGENTS.md` into context.

So: write once in `AGENTS.md`; every Claude Code conversation picks up the changes
with no duplication and nothing for you to copy. (Other agents — OpenCode, Codex,
etc. — read `AGENTS.md` directly.)

@AGENTS.md
