import { describe, expect, it } from "vitest";

import { runAgentLaunch } from "./agentLaunch";

describe("runAgentLaunch", () => {
  it("writes once", async () => {
    const inst = { launched: false };
    let writes = 0;
    await runAgentLaunch(inst, async () => {
      writes += 1;
    });

    expect(writes).toBe(1);
    expect(inst.launched).toBe(true);
  });

  it("ignores a second call once the launch is claimed", async () => {
    const inst = { launched: false };
    let writes = 0;
    const write = async () => {
      writes += 1;
    };

    await runAgentLaunch(inst, write);
    await runAgentLaunch(inst, write);

    expect(writes).toBe(1);
  });

  it("claims before awaiting, so output arriving mid-write cannot start a second", async () => {
    // The regression this exists for. A launch is not one statement — it
    // resolves the MCP catalog and then writes, both backend round-trips — and
    // every PTY output chunk re-arms the timer that calls this. The shell's echo
    // of the command line lands inside exactly this window. If the claim came
    // after the write, that second call would run and type the whole launch line
    // into the agent that the first one just started.
    const inst = { launched: false };
    let writes = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const first = runAgentLaunch(inst, async () => {
      await gate;
      writes += 1;
    });

    // Mid-write: the flag must already read claimed.
    expect(inst.launched).toBe(true);
    await runAgentLaunch(inst, async () => {
      writes += 1;
    });

    release();
    await first;
    expect(writes).toBe(1);
  });

  it("hands the claim back when the write fails, so it stays retryable", async () => {
    // A PTY the backend is not ready to write to must not burn the one-shot:
    // the next output chunk (or the fallback timer) reschedules.
    const inst = { launched: false };
    let attempts = 0;

    await runAgentLaunch(inst, async () => {
      attempts += 1;
      throw new Error("pty not ready");
    });
    expect(inst.launched).toBe(false);

    await runAgentLaunch(inst, async () => {
      attempts += 1;
    });

    expect(attempts).toBe(2);
    expect(inst.launched).toBe(true);
  });
});
