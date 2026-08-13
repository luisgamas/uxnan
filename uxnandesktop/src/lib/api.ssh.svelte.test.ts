/**
 * The SSH config wrappers, driven through the real IPC layer.
 *
 * These functions are thin, which is exactly why they are worth testing here
 * rather than with a mocked `$lib/api`: what can break is the *contract* — a
 * command name that no longer matches the Rust `#[tauri::command]`, or an
 * argument marshalled under the wrong key. `installFakeBackend` replaces the
 * transport, so `api.ts` runs for real and those are the things asserted.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { installFakeBackend, type FakeBackend } from "../test/tauri";
import {
  sshConfigHosts,
  sshConfigResolve,
  sshHostAdd,
  sshHostConnect,
  sshHostDisconnect,
  sshHostsConnected,
  sshBrowseDirs,
  sshRepoAdd,
  sshHostProbe,
  sshHostRemove,
  sshHostTrust,
  sshHostsList,
} from "$lib/api";
import type { SshHost, SshHostDraft, SshResolvedHost } from "$lib/types";

const RESOLVED: SshResolvedHost = {
  hostname: "10.0.0.5",
  port: 2222,
  user: "dev",
  identityFiles: ["~/.ssh/id_ed25519"],
  identityAgent: null,
  identitiesOnly: true,
  forwardAgent: true,
  proxyCommand: null,
  proxyJump: "bastion",
};

describe("ssh config API", () => {
  let backend: FakeBackend;

  beforeEach(() => {
    backend = installFakeBackend({
      ssh_config_hosts: () => [
        { alias: "build-box", source: "C:/Users/dev/.ssh/config" },
        { alias: "mac-mini", source: "C:/Users/dev/.ssh/config" },
      ],
      ssh_config_resolve: () => RESOLVED,
    });
  });

  it("lists the aliases the backend found", async () => {
    const hosts = await sshConfigHosts();
    expect(hosts.map((h) => h.alias)).toEqual(["build-box", "mac-mini"]);
    expect(backend.called("ssh_config_hosts")).toBe(true);
  });

  it("sends the alias under the key the Rust command expects", async () => {
    await sshConfigResolve("build-box");
    expect(backend.lastCallTo("ssh_config_resolve")?.args).toEqual({ alias: "build-box" });
  });

  it("returns the resolved settings the UI acts on", async () => {
    const resolved = await sshConfigResolve("build-box");
    expect(resolved.hostname).toBe("10.0.0.5");
    expect(resolved.port).toBe(2222);
    expect(resolved.forwardAgent).toBe(true);
    expect(resolved.proxyJump).toBe("bastion");
  });

  it("propagates a resolution failure instead of inventing a host", async () => {
    // `ssh -G` failing means we do not know where this alias points. Connecting
    // to a guessed hostname is the one outcome that must never happen.
    backend.setCommands({
      ssh_config_resolve: () => {
        throw new Error("`ssh -G nope` failed: no such host");
      },
    });
    await expect(sshConfigResolve("nope")).rejects.toThrow(/no such host/);
  });
});

const HOST: SshHost = {
  id: "h1",
  label: "build-box",
  hostname: "10.0.0.5",
  port: 22,
  user: "dev",
};

describe("ssh host registry API", () => {
  let backend: FakeBackend;

  beforeEach(() => {
    backend = installFakeBackend({
      ssh_hosts_list: () => [HOST],
      ssh_host_add: () => ({ host: HOST, recovered: false, updatedExisting: false }),
      ssh_host_remove: () => true,
      ssh_host_probe: () => ({
        status: "unknown",
        fingerprint: "SHA256:abc",
        algorithm: "ssh-ed25519",
      }),
      ssh_host_trust: () => true,
    });
  });

  it("lists registered hosts", async () => {
    const hosts = await sshHostsList();
    expect(hosts.map((h) => h.id)).toEqual(["h1"]);
  });

  it("sends the draft under the key the Rust command expects, and never an id", async () => {
    const draft: SshHostDraft = {
      label: "build-box",
      hostname: "10.0.0.5",
      port: 22,
      user: "dev",
    };
    await sshHostAdd(draft);
    const args = backend.lastCallTo("ssh_host_add")?.args;
    expect(args).toEqual({ draft });
    // Ids are minted by the backend; a UI that could send one could overwrite
    // an unrelated record by guessing it.
    expect(JSON.stringify(args)).not.toContain('"id"');
  });

  it("reports a recovered host so the UI can say projects came back", async () => {
    backend.setCommands({
      ssh_host_add: () => ({ host: HOST, recovered: true, updatedExisting: false }),
    });
    const result = await sshHostAdd({ label: "x", hostname: "10.0.0.5", port: 22, user: "dev" });
    expect(result.recovered).toBe(true);
  });

  it("passes the host id for remove, probe and trust", async () => {
    await sshHostRemove("h1");
    await sshHostProbe("h1");
    await sshHostTrust("h1");
    for (const command of ["ssh_host_remove", "ssh_host_probe", "ssh_host_trust"]) {
      expect(backend.lastCallTo(command)?.args).toEqual({ hostId: "h1" });
    }
  });

  it("surfaces an unknown host key with its fingerprint, not as an error", async () => {
    const probe = await sshHostProbe("h1");
    expect(probe.status).toBe("unknown");
    expect(probe.fingerprint).toBe("SHA256:abc");
  });

  it("propagates a refused trust instead of pretending it worked", async () => {
    backend.setCommands({
      ssh_host_trust: () => {
        throw new Error("no host key is awaiting confirmation for this host");
      },
    });
    await expect(sshHostTrust("h1")).rejects.toThrow(/awaiting confirmation/);
  });
});

describe("ssh session API", () => {
  let backend: FakeBackend;

  beforeEach(() => {
    backend = installFakeBackend({
      ssh_host_connect: () => ({
        status: "connected",
        generation: 3,
        method: "ssh-agent",
        attempted: [],
      }),
      ssh_host_disconnect: () => true,
      ssh_hosts_connected: () => ["h1"],
    });
  });

  it("connects without sending a password when there is none", async () => {
    const report = await sshHostConnect("h1");
    expect(report.status).toBe("connected");
    expect(report.generation).toBe(3);
    expect(backend.lastCallTo("ssh_host_connect")?.args).toEqual({
      hostId: "h1",
      password: null,
    });
  });

  it("sends a password only when one was supplied", async () => {
    await sshHostConnect("h1", "s3cret");
    expect(backend.lastCallTo("ssh_host_connect")?.args).toEqual({
      hostId: "h1",
      password: "s3cret",
    });
  });

  it("reports an unknown host key as an outcome to act on, not an error", async () => {
    backend.setCommands({
      ssh_host_connect: () => ({
        status: "hostUnknown",
        fingerprint: "SHA256:abc",
        attempted: [],
      }),
    });
    const report = await sshHostConnect("h1");
    expect(report.status).toBe("hostUnknown");
    expect(report.fingerprint).toBe("SHA256:abc");
  });

  it("reports a refused key alongside the password path", async () => {
    // Both facts matter: which key was refused, and what to try next.
    backend.setCommands({
      ssh_host_connect: () => ({
        status: "needsPassword",
        attempted: ["C:/keys/id_ed25519"],
      }),
    });
    const report = await sshHostConnect("h1");
    expect(report.status).toBe("needsPassword");
    expect(report.attempted).toEqual(["C:/keys/id_ed25519"]);
  });

  it("lists connected hosts and disconnects by id", async () => {
    expect(await sshHostsConnected()).toEqual(["h1"]);
    expect(await sshHostDisconnect("h1")).toBe(true);
    expect(backend.lastCallTo("ssh_host_disconnect")?.args).toEqual({ hostId: "h1" });
  });
});

describe("ssh browse API", () => {
  let backend: FakeBackend;

  beforeEach(() => {
    backend = installFakeBackend({
      ssh_browse_dirs: () => ({
        path: "C:\Users\dev",
        parent: "C:\Users",
        dirs: [{ name: "code", path: "C:\Users\dev\code" }],
        truncated: false,
      }),
      ssh_repo_add: () => ({
        id: "r1",
        name: "code",
        path: "C:\Users\dev\code",
        target: "ssh:h1",
        worktrees: [],
      }),
    });
  });

  it("asks for the home directory with an empty path", async () => {
    // Only the host knows where home is; sending a guess would be wrong on
    // macOS, on Windows, and for anyone with a moved home.
    await sshBrowseDirs("h1", "");
    expect(backend.lastCallTo("ssh_browse_dirs")?.args).toEqual({ hostId: "h1", path: "" });
  });

  it("returns the host's own spelling of a path", async () => {
    const listing = await sshBrowseDirs("h1", "");
    expect(listing.path).toBe("C:\Users\dev");
    expect(listing.dirs[0].path).toBe("C:\Users\dev\code");
    expect(listing.parent).toBe("C:\Users");
  });

  it("registers a project with the host it lives on", async () => {
    const repo = await sshRepoAdd("h1", "C:\Users\dev\code");
    expect(backend.lastCallTo("ssh_repo_add")?.args).toEqual({
      hostId: "h1",
      path: "C:\Users\dev\code",
    });
    // The target is what makes this project distinct from a local one at the
    // same path — the badge, the terminal's cwd rule and the fencing all read it.
    expect(repo.target).toBe("ssh:h1");
  });

  it("surfaces a listing failure instead of showing an empty folder", async () => {
    // "This folder is empty" and "I could not read it" are different answers.
    backend.setCommands({
      ssh_browse_dirs: () => {
        throw new Error("connect to this host before browsing it");
      },
    });
    await expect(sshBrowseDirs("h1", "")).rejects.toThrow(/connect to this host/);
  });
});
