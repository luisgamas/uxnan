import { beforeEach, describe, expect, it, vi } from "vitest";

const aiCommitAgents = vi.fn();
vi.mock("$lib/api", () => ({ aiCommitAgents: () => aiCommitAgents() }));

const hosts = {
  inventories: {} as Record<string, { agents: Record<string, string> }>,
  connected: [] as string[],
  isConnected(id: string) {
    return this.connected.includes(id);
  },
  loadInventory: vi.fn(async (id: string) => {
    hosts.inventories[id] = { agents: { claude: "2.1.0", codex: "0.9.0" } };
  }),
  labelOf: (id: string) => (id === "h1" ? "build-box" : id),
};
vi.mock("$lib/state/hosts.svelte", () => ({ hosts }));

const { agentsOn, folderOnMachine } = await import("./agents");

describe("agentsOn", () => {
  beforeEach(() => {
    hosts.inventories = {};
    hosts.connected = [];
    hosts.loadInventory.mockClear();
    aiCommitAgents.mockReset();
  });

  it("asks this machine for its own agents", async () => {
    aiCommitAgents.mockResolvedValue(["claude", "pi"]);
    expect(await agentsOn("local")).toEqual(["claude", "pi"]);
    expect(await agentsOn(undefined)).toEqual(["claude", "pi"]);
  });

  it("asks a connected host's inventory, never this machine", async () => {
    hosts.connected = ["h1"];
    expect(await agentsOn("ssh:h1")).toEqual(["claude", "codex"]);
    expect(aiCommitAgents).not.toHaveBeenCalled();
  });

  it("knows nothing of a host that is not connected", async () => {
    expect(await agentsOn("ssh:h1")).toEqual([]);
    expect(hosts.loadInventory).not.toHaveBeenCalled();
  });
});

describe("folderOnMachine", () => {
  it("names the host a folder is on, and leaves this machine's alone", () => {
    expect(folderOnMachine("/srv/app", "ssh:h1")).toBe("build-box: /srv/app");
    expect(folderOnMachine("/code/app", "local")).toBe("/code/app");
    expect(folderOnMachine("/code/app", undefined)).toBe("/code/app");
  });
});
