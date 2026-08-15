// Run the live SSH suite against the Linux container, with the environment the
// tests read already set.
//
// Separate from `ssh-test-host.mjs` because that script's job is the host and
// this one's is the run: `npm run test:ssh:linux` brings the host up and then
// calls this, and CI calls the two in the same order for the same reason.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = process.env.UXNAN_SSH_TEST_PORT ?? "2222";
const here = dirname(fileURLToPath(import.meta.url));
const manifest = join(here, "..", "src-tauri", "Cargo.toml");

// `--ignored` because these are opt-in probes like every other live test, and
// `posix_host` because that is the module that needs the container. The rest of
// the ignored suite talks to this machine's own sshd, which CI does not run.
const result = spawnSync(
  "cargo",
  ["test", "--manifest-path", manifest, "--lib", "--", "--ignored", "--nocapture", "posix_host"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      UXNAN_SSH_TEST_HOST: `127.0.0.1:${PORT}`,
      UXNAN_SSH_TEST_USER: "uxnan",
      UXNAN_SSH_TEST_PASSWORD: "uxnan",
    },
  },
);

if (result.error) {
  console.error("could not run cargo:", result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
