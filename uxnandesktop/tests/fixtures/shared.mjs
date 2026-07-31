/**
 * Fixtures shared with the resource benchmarks.
 *
 * The benchmark harness already needed a deterministic git repository, an
 * offline stand-in agent, a loopback HTTP server and a way to seed a disposable
 * app profile. Those are the same four things the test harness needs, and a
 * second copy of any of them would be a second thing to keep correct — the
 * generated repo in particular is only useful *because* its commit hash is
 * pinned, and two generators would drift the moment one was touched.
 *
 * So this module re-exports them rather than reimplementing them. The benchmark
 * side owns the implementations (`scripts/resources/`); the test side owns the
 * fixtures that are specific to testing (`fake-gh`, the legacy profiles, the
 * PATH shim).
 */

export { makeRepo } from "../../scripts/resources/fixtures/make-repo.mjs";
export {
  GLOBAL_WORKSPACE,
  group,
  layout,
  liveTerminalCount,
  project,
  settings,
  shellRunning,
  split,
  terminalGrid,
  terminalTab,
  writeProfile,
} from "../../scripts/resources/lib/profile.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESOURCE_FIXTURES = path.resolve(HERE, "..", "..", "scripts", "resources", "fixtures");

/** The offline stand-in agent: emits output, waits, emits again, exits 0. */
export const FAKE_AGENT = path.join(RESOURCE_FIXTURES, "agent-fixture.mjs");

/** A fixed page served from loopback, for anything that opens the browser. */
export const FIXTURE_HTTP_SERVER = path.join(RESOURCE_FIXTURES, "http-server.mjs");
