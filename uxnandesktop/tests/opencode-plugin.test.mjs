/**
 * The OpenCode status plugin speaks both of OpenCode's plugin APIs.
 *
 * `static/hooks/uxnan-opencode-status-plugin.js` is installed into OpenCode's,
 * MiMo Code's and Kilo Code's plugin directories and runs inside their server.
 * OpenCode 2 replaced the plugin API and the event vocabulary at once, so the
 * file carries a V1 factory (`server`) and a V2 `setup` behind one default
 * export. This drives both paths with events shaped exactly like the ones a
 * real run emitted (OpenCode 2.0.16 and 1.18.32; names and fields copied from
 * captured payloads) and checks what the hook server would be told.
 *
 * What is enforced here:
 *   - the export shape every host was measured to load: a single default
 *     descriptor with an `id`, a `setup` and a `server`;
 *   - V2: a turn, a permission, a question, a sub-agent and an interruption map
 *     to the synthetic vocabulary, a child session never flips its parent, and
 *     the prompt, tool and reply ride along;
 *   - V2 stays silent inside the shared background service, whose environment
 *     names whichever tab started it — not the one this session runs in;
 *   - `setup` is inert on a V1 host (no event stream), so nothing reports twice;
 *   - V1 still maps its bus events, and an error object is reported as text.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(HERE, "..", "static", "hooks", "uxnan-opencode-status-plugin.js");

let mod;
let posts;

beforeAll(async () => {
  mod = await import(/* @vite-ignore */ pathToFileURL(PLUGIN).href);
});

beforeEach(() => {
  posts = [];
  vi.stubEnv("UXNAN_HOOK_URL", "http://127.0.0.1:9/hook");
  vi.stubEnv("UXNAN_HOOK_TOKEN", "t");
  vi.stubEnv("UXNAN_AGENT_ID", "tab-1");
  vi.stubEnv("UXNAN_ENDPOINT_FILE", "");
  vi.stubGlobal("fetch", async (_url, init) => {
    posts.push(JSON.parse(init.body));
    return { ok: true };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A V2 context whose event stream yields `events`, and a promise that
 *  resolves once the plugin has consumed all of them. */
function v2Context(events) {
  let done;
  const drained = new Promise((r) => (done = r));
  async function* stream() {
    for (const e of events) yield e;
    // Let the last report's fetch settle before the test reads `posts`.
    await new Promise((r) => setTimeout(r, 0));
    done();
  }
  return { ctx: { event: { subscribe: () => stream() } }, drained };
}

/** What the hook server would record: `[event, source-without-undefined]`. */
function reported() {
  return posts.map((p) => [p.event, JSON.parse(JSON.stringify(p.source ?? {}))]);
}

const ev = (type, data) => ({ id: `evt_${type}`, created: 1, type, data });

describe("export shape", () => {
  it("is one default descriptor with an id, a V2 setup and a V1 server", () => {
    expect(Object.keys(mod)).toEqual(["default"]);
    expect(mod.default.id).toBe("uxnan-status");
    expect(typeof mod.default.setup).toBe("function");
    expect(typeof mod.default.server).toBe("function");
  });
});

describe("OpenCode 2 (setup)", () => {
  it("reports a turn with its prompt, tool and reply", async () => {
    const s = "ses_turn";
    const { ctx, drained } = v2Context([
      ev("session.created", { sessionID: s, agent: "build" }),
      ev("session.inbox.enqueued", {
        sessionID: s,
        item: { type: "user", payload: { text: "Reply with ok" } },
      }),
      ev("session.execution.started", { sessionID: s }),
      ev("session.tool.input.started", { sessionID: s, name: "shell" }),
      ev("session.text.ended", { sessionID: s, text: "ok" }),
      ev("session.execution.succeeded", { sessionID: s }),
    ]);
    await mod.default.setup(ctx);
    await drained;
    expect(reported()).toEqual([
      ["SessionBusy", { sessionID: s, prompt: "Reply with ok" }],
      ["SessionBusy", { sessionID: s }],
      ["SessionBusy", { sessionID: s, tool_name: "shell" }],
      ["MessagePart", { sessionID: s, role: "assistant", text: "ok" }],
      ["SessionIdle", { sessionID: s, last_assistant_message: "ok" }],
    ]);
    expect(posts.every((p) => p.agentId === "tab-1" && p.agentType === "opencode")).toBe(true);
  });

  it("waits on a permission and on a question, and resumes on the answer", async () => {
    const s = "ses_wait";
    const { ctx, drained } = v2Context([
      ev("permission.asked", { id: "per_1", sessionID: s, action: "shell" }),
      ev("permission.replied", { sessionID: s, requestID: "per_1", reply: "once" }),
      ev("form.created", { form: { id: "frm_1", sessionID: s, metadata: { kind: "question" } } }),
      ev("form.replied", { id: "frm_1", sessionID: s }),
    ]);
    await mod.default.setup(ctx);
    await drained;
    expect(reported().map(([e]) => e)).toEqual([
      "PermissionRequest",
      "SessionBusy",
      "AskUserQuestion",
      "SessionBusy",
    ]);
    expect(reported().every(([, src]) => src.sessionID === s)).toBe(true);
  });

  it("reports a sub-agent without letting it flip its parent", async () => {
    const parent = "ses_parent";
    const child = "ses_child";
    const { ctx, drained } = v2Context([
      ev("session.execution.started", { sessionID: parent }),
      ev("session.created", {
        sessionID: child,
        parentID: parent,
        agent: "general",
        title: "Reply with the word ready",
      }),
      ev("session.execution.started", { sessionID: child }),
      ev("session.text.ended", { sessionID: child, text: "ready" }),
      ev("session.execution.succeeded", { sessionID: child }),
      ev("session.execution.succeeded", { sessionID: parent }),
    ]);
    await mod.default.setup(ctx);
    await drained;
    expect(reported()).toEqual([
      ["SessionBusy", { sessionID: parent }],
      [
        "SubagentStart",
        { agent_id: child, agent_type: "general", description: "Reply with the word ready" },
      ],
      ["SubagentStop", { agent_id: child }],
      ["SessionIdle", { sessionID: parent }],
    ]);
  });

  it("marks an interrupted turn and reports a failed one as an error", async () => {
    const s = "ses_end";
    const { ctx, drained } = v2Context([
      ev("session.execution.interrupted", { sessionID: s }),
      ev("session.execution.failed", {
        sessionID: s,
        error: { type: "provider", message: "rate limited" },
      }),
    ]);
    await mod.default.setup(ctx);
    await drained;
    expect(reported()).toEqual([
      ["SessionIdle", { sessionID: s, interrupted: true }],
      ["Error", { sessionID: s, error: "rate limited" }],
    ]);
  });

  it("stays silent inside the shared background service", async () => {
    const argv = process.argv;
    process.argv = ["bun", "/$bunfs/root/opencode", "serve", "--service"];
    try {
      const subscribe = vi.fn();
      await mod.default.setup({ event: { subscribe } });
      expect(subscribe).not.toHaveBeenCalled();
    } finally {
      process.argv = argv;
    }
    expect(posts).toEqual([]);
  });

  it("does nothing on a V1 host, whose setup context has no event stream", async () => {
    // What OpenCode 1.17+ and Kilo hand `setup` (measured): no `event`.
    await mod.default.setup({ options: {}, agent: {}, plugin: {} });
    await mod.default.setup(undefined);
    expect(posts).toEqual([]);
  });
});

describe("OpenCode 1 (server)", () => {
  it("maps the V1 bus events", async () => {
    const hooks = await mod.default.server();
    const s = "ses_v1";
    for (const event of [
      { type: "session.status", properties: { sessionID: s, status: { type: "busy" } } },
      { type: "session.error", properties: { sessionID: s, error: { name: "ProviderAuthError", data: { message: "no key" } } } },
      { type: "session.idle", properties: { sessionID: s } },
    ]) {
      await hooks.event({ event });
    }
    expect(reported()).toEqual([
      ["SessionBusy", { sessionID: s }],
      ["Error", { sessionID: s, error: "no key" }],
      ["SessionIdle", { sessionID: s }],
    ]);
  });
});
