// Bring up (or take down) the Linux SSH host the live remote-hosts tests use.
//
//   node scripts/ssh-test-host.mjs up      # build + run, print the env to export
//   node scripts/ssh-test-host.mjs down    # stop and remove
//   node scripts/ssh-test-host.mjs status  # is it listening?
//
// Why a container at all: every live SSH test runs against the `sshd` of the
// machine running them, which on this project has always been Windows. The POSIX
// half of `shellkind`, of the inventory probe and of the remote git script had
// therefore never executed anywhere. A container is the cheapest honest Linux
// host, and it is reproducible enough to run in CI.
//
// It binds **127.0.0.1 only**. Nothing here should be reachable from a network.

import { spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const IMAGE = "uxnan/ssh-test-host:latest";
const NAME = "uxnan-ssh-test-host";
// Overridable so two checkouts (or a CI matrix) can run side by side. Bound to
// loopback either way.
const PORT = Number(process.env.UXNAN_SSH_TEST_PORT ?? 2222);
const USER = "uxnan";
const PASSWORD = "uxnan";

const here = dirname(fileURLToPath(import.meta.url));
const context = join(here, "..", "docker", "ssh-test-host");

function docker(args, { quiet = false } = {}) {
  const out = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
  });
  if (out.error) {
    console.error(
      "docker is not available on this machine. The live SSH suite that needs a\n" +
        "Linux host will not run; the rest of the tests are unaffected.",
    );
    process.exit(2);
  }
  return out;
}

/** Whether something is listening on the mapped port yet. */
function listening() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: PORT });
    socket.setTimeout(500);
    socket.on("connect", () => (socket.destroy(), resolve(true)));
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => (socket.destroy(), resolve(false)));
  });
}

/** Whether sshd itself said it is ready, not merely that the port answers.
 *
 *  Docker publishes the port before the daemon inside is accepting, so a plain
 *  TCP probe can hand back a container that refuses the next connection. The
 *  daemon's own line is the honest signal. */
function ready() {
  const logs = docker(["logs", NAME], { quiet: true });
  return `${logs.stdout ?? ""}${logs.stderr ?? ""}`.includes("Server listening on");
}

async function waitUntilUp(seconds = 30) {
  for (let i = 0; i < seconds * 4; i++) {
    if ((await listening()) && ready()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const command = process.argv[2] ?? "up";

if (command === "down") {
  docker(["rm", "-f", NAME], { quiet: true });
  console.log(`${NAME}: removed`);
  process.exit(0);
}

if (command === "status") {
  const up = await listening();
  console.log(up ? `${NAME}: listening on 127.0.0.1:${PORT}` : `${NAME}: not running`);
  process.exit(up ? 0 : 1);
}

if (command !== "up") {
  console.error(`unknown command "${command}" — use up | down | status`);
  process.exit(64);
}

// Rebuilding is cheap when nothing changed (layer cache) and is what makes the
// image match the Dockerfile in the tree rather than whatever was built once.
const build = docker(["build", "-t", IMAGE, context]);
if (build.status !== 0) process.exit(build.status ?? 1);

// Replace any previous instance, so `up` is idempotent and never leaves the
// tests talking to a container built from an older Dockerfile.
docker(["rm", "-f", NAME], { quiet: true });
const run = docker([
  "run", "-d", "--name", NAME,
  // Loopback only. This container has a published password.
  "-p", `127.0.0.1:${PORT}:22`,
  IMAGE,
]);
if (run.status !== 0) process.exit(run.status ?? 1);

if (!(await waitUntilUp())) {
  // The daemon's own output is what a reader needs here, so print it rather
  // than telling them to go and find it.
  const logs = docker(["logs", NAME], { quiet: true });
  console.error(`the container started but sshd never reported itself ready:
${logs.stdout ?? ""}${logs.stderr ?? ""}`);
  process.exit(1);
}

console.log(`${NAME}: listening on 127.0.0.1:${PORT}`);
console.log("");
console.log("PowerShell:");
console.log(`  $env:UXNAN_SSH_TEST_HOST='127.0.0.1:${PORT}'`);
console.log(`  $env:UXNAN_SSH_TEST_USER='${USER}'`);
console.log(`  $env:UXNAN_SSH_TEST_PASSWORD='${PASSWORD}'`);
console.log("");
console.log("bash:");
console.log(`  export UXNAN_SSH_TEST_HOST=127.0.0.1:${PORT} UXNAN_SSH_TEST_USER=${USER} UXNAN_SSH_TEST_PASSWORD=${PASSWORD}`);
