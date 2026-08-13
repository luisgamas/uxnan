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
