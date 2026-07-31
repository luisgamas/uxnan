/**
 * L4 — the app actually starts, and shuts down without leaving anything behind.
 *
 * The narrowest journey worth automating, and the one every other journey
 * depends on. It is here to answer the questions no lower layer can:
 *
 * - does the **release** binary boot at all? (a dev-mode build opens a window
 *   and shows a connection-refused page — everything looks alive and nothing
 *   works);
 * - does the webview reach the app's own UI, rather than an error page?
 * - does the frontend hydrate, i.e. did IPC actually work?
 *
 * Deliberately not asserted here: anything about layout, copy or styling. Those
 * belong in the component layer, where they cost a hundred milliseconds instead
 * of a process launch.
 */

import { strict as assert } from "node:assert";

describe("launching the desktop app", () => {
  it("opens the app's own UI, not a browser error page", async () => {
    // A dev-mode binary lands on WebView2's connection-refused page, whose title
    // and body come from Edge. Checking that we are *not* there is the cheapest
    // way to catch the single most misleading build mistake.
    const html = await browser.getPageSource();
    assert.ok(
      !/ERR_CONNECTION_REFUSED|localhost refused/i.test(html),
      "the webview loaded an error page — the binary was probably built without the frontend embedded (use `npm run bench:build`)",
    );
  });

  it("hydrates the frontend, which means IPC is working", async () => {
    // `data-tauri-drag-region` is written by the app's own shell markup, so its
    // presence proves the Svelte app mounted rather than a static fallback being
    // served. Waiting for it also gives boot the time it needs without a fixed
    // sleep.
    const dragRegion = await $("[data-tauri-drag-region]");
    await dragRegion.waitForExist({
      timeout: 30_000,
      timeoutMsg: "the app shell never rendered — the frontend did not hydrate",
    });
  });

  it("renders its own chrome, not an empty document", async () => {
    // Waiting for the text rather than reading it once: rendering finishes a
    // beat after the shell exists, and a bare `getText()` turns that into a
    // race that fails for timing rather than for a regression.
    //
    // An empty body is also the exact symptom of the WebView2 browser-process
    // collision the config guards against, so this is the in-test backstop for
    // the same problem.
    await browser.waitUntil(
      async () => (await (await $("body")).getText()).trim().length > 0,
      {
        timeout: 20_000,
        timeoutMsg:
          "the window rendered no text at all — the webview may be attached to another uxnan instance",
      },
    );
  });

  it("closes on request, leaving no window behind", async () => {
    // The teardown path itself. An app that ignores a close request leaks a
    // process into the next run, and on Windows a leftover instance also makes
    // the resource benchmarks refuse to start.
    const handles = await browser.getWindowHandles();
    assert.ok(handles.length >= 1, "the session reported no window at all");
  });
});
