/**
 * The integrated browser opens a page, and closes it.
 *
 * Worth an end-to-end test because nothing else here covers it: each
 * workspace's page is a **child webview of the main window** — a second native
 * view the app creates, places, tracks and tears down — and the only way to know
 * that works on a platform is to run it there.
 *
 * The page comes from the shared loopback fixture, so the test needs no network
 * and the content is fixed. The journey goes through the real entry point every
 * link uses (`open_url`) and reads the backend's own account of the page
 * (`browser_sessions`), so it proves a page exists and loaded rather than that a
 * button was drawn.
 *
 * Not asserted here: the URL gate. `open_url` deliberately *routes* rather than
 * rejects — a non-http(s) link is handed to the OS instead of loaded in-app — so
 * calling it with `file://` in a test would open something on the developer's
 * desktop rather than fail. The gate is a pure decision, unit-tested in
 * `src-tauri/src/browser/mod.rs`, which is the right layer for it.
 */

import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { invoke } from "../helpers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SERVER = path.resolve(
  HERE,
  "..",
  "..",
  "..",
  "scripts",
  "resources",
  "fixtures",
  "http-server.mjs",
);

/** The live page whose URL starts with `prefix`, if any. */
async function pageAt(prefix) {
  const sessions = await invoke("browser_sessions");
  return sessions.find((s) => s.live && s.url.startsWith(prefix)) ?? null;
}

describe("the integrated browser", () => {
  let server;
  let url;

  before(async () => {
    server = spawn(process.execPath, [FIXTURE_SERVER], {
      stdio: ["ignore", "pipe", "inherit"],
      windowsHide: true,
    });
    // The fixture prints its port once listening, so the test waits for a line
    // rather than guessing a port or sleeping.
    url = await new Promise((resolve, reject) => {
      const rl = readline.createInterface({ input: server.stdout });
      const timer = setTimeout(
        () => reject(new Error("the fixture server never announced a port")),
        15_000,
      );
      rl.once("line", (line) => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(line).url);
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  after(() => server?.kill());

  it("opens a loopback page in the workspace on screen and loads it", async () => {
    // `open_url` is the single decision every link funnels through, so this is
    // the real entry point rather than a shortcut into the browser module.
    await invoke("open_url", { url });

    await browser.waitUntil(
      async () => {
        const page = await pageAt(url);
        return !!page && !page.loading;
      },
      {
        timeout: 30_000,
        interval: 500,
        timeoutMsg: "the browser page never loaded",
      },
    );

    const page = await pageAt(url);
    assert.ok(page.generation >= 1, "no document was committed");
    assert.equal(page.visible, true, "the page of the workspace on screen is hidden");
  });

  it("closes the page and forgets it", async () => {
    const page = await pageAt(url);
    assert.ok(page, "no page to close");
    await invoke("browser_close", { workspace: page.workspace });
    await browser.waitUntil(async () => (await pageAt(url)) === null, {
      timeout: 10_000,
      interval: 250,
      timeoutMsg: "the page outlived its close",
    });
  });
});
