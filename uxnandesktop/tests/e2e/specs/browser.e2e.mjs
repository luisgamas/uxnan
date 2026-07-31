/**
 * The integrated browser opens a page in a second window.
 *
 * Worth an end-to-end test for one reason nothing else here covers: the browser
 * is a **separate `WebviewWindow`**, so this is the only journey that exercises
 * multi-window handling — the app owning, positioning and tearing down a window
 * that is not its main one.
 *
 * The page comes from the shared loopback fixture, so the test needs no network
 * and the content is fixed.
 *
 * Not asserted here: the scheme gate. `open_url` deliberately *routes* rather
 * than rejects — a non-http(s) link is handed to the OS instead of loaded in the
 * window — so calling it with `file://` in a test would open something on the
 * developer's desktop rather than fail. The gate itself is a pure decision and
 * is unit-tested in `browser.rs`, which is the right layer for it.
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

  it("opens a loopback page in its own window", async () => {
    const before = (await browser.getWindowHandles()).length;

    // `open_url` is the single decision every link funnels through, so this is
    // the real entry point rather than a shortcut into the browser module.
    await invoke("open_url", { url });

    await browser.waitUntil(
      async () => (await browser.getWindowHandles()).length > before,
      {
        timeout: 30_000,
        interval: 500,
        timeoutMsg: "the browser window never appeared",
      },
    );

    const handles = await browser.getWindowHandles();
    assert.ok(handles.length > before, "no second window was created");
  });
});
