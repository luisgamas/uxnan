/**
 * L4, OPT-IN — the GitHub surface end to end against the fake `gh`.
 *
 * What only this layer can prove about GitHub: that the **shipped app**
 * resolves `gh` from PATH, spawns it (on Windows the fixture is a `.cmd` —
 * exactly the resolution bug the CLI-contract suite pinned down), parses the
 * answers and serves them over real IPC. The answers themselves are the
 * captured real payloads from `tests/fixtures/github/`, seeded by the
 * `github-fake` journey; no network, no account, and the repo's github.com
 * origin is never contacted, because `gh` is the only thing that would and
 * `gh` is the fixture.
 *
 * **Opt-in:** requires `UXNAN_E2E_FAKE_GH=1` (which makes `wdio.conf.mjs`
 * prepend the gh-only shim to the app's PATH). Without it every test here
 * self-skips, so the default suite's environment stays untouched:
 *
 * ```
 * UXNAN_E2E_FAKE_GH=1 npm run test:e2e -- --spec tests/e2e/specs/github-fake.e2e.mjs
 * ```
 *
 * Assertions go through IPC, not the DOM: the UI is localized, and what this
 * journey exists to prove is the backend chain, not a translation.
 */

import { strict as assert } from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { invoke } from "../helpers.mjs";
import { factsFor } from "../journeys.mjs";

const ENABLED = process.env.UXNAN_E2E_FAKE_GH === "1";
/** The run's fixed disposable profile (same path `wdio.conf.mjs` seeds). */
const PROFILE_DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".profile", "data");

describe("GitHub against the fake gh (opt-in)", () => {
  before(function () {
    if (!ENABLED) this.skip();
  });

  it("reports the fixture account through the whole status chain", async () => {
    const status = await invoke("github_status");
    assert.equal(status.ghInstalled, true, "the shim resolves as an installed gh");
    assert.equal(status.authenticated, true);
    assert.equal(status.login, "fixture-user");
    assert.ok(Array.isArray(status.scopes) && status.scopes.includes("repo"), `scopes: ${status.scopes}`);
  });

  it("lists the captured real PRs for the seeded repo", async () => {
    const facts = factsFor(PROFILE_DATA);
    const rows = await invoke("github_pr_list", {
      worktreePath: facts.repoDir,
      state: "all",
      search: null,
      limit: 50,
    });
    assert.equal(rows.length, facts.prCount, "every captured row parsed");
    assert.equal(rows[0].number, facts.firstPr.number);
    assert.equal(rows[0].title, facts.firstPr.title);
    assert.ok(rows[0].url.startsWith("https://github.com/"), rows[0].url);
  });

  it("reads the captured rate limit for the status readout", async () => {
    const facts = factsFor(PROFILE_DATA);
    const limit = await invoke("github_rate_limit");
    assert.equal(limit.limit, facts.rateLimit);
    assert.ok(limit.remaining <= limit.limit);
  });

  it("answers an empty issue list as the empty state, not an error", async () => {
    const facts = factsFor(PROFILE_DATA);
    const rows = await invoke("github_issue_list", {
      worktreePath: facts.repoDir,
      state: "open",
      search: null,
      limit: 50,
    });
    assert.deepEqual(rows, []);
  });
});
