# Uxnan — Gemini CLI entry point

**Single source of truth: [`AGENTS.md`](AGENTS.md).** Keep every rule, convention
and status note there — not here. This file exists only so Gemini CLI loads those
guidelines automatically: Gemini CLI reads `GEMINI.md` as its context file and
resolves the `@`-import below by inlining `AGENTS.md`.

So: write once in `AGENTS.md`; every Gemini CLI session picks up the changes with
no duplication and nothing for you to copy. (Codex and OpenCode read `AGENTS.md`
directly; Claude Code imports it via `CLAUDE.md`.)

@AGENTS.md
