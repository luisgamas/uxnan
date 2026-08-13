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
import { sshConfigHosts, sshConfigResolve } from "$lib/api";
import type { SshResolvedHost } from "$lib/types";

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
