// Remote hosts state for Settings → Hosts (Svelte 5 runes).
//
// The connect flow is the whole reason this store exists. Reaching a host can
// end in six different places, and each one is a different thing to ask the
// user — trust this key, type a password, unlock this key file, or nothing at
// all. Collapsing them into "connected / failed" would push that decision into
// the component, where it would be re-derived (and eventually got wrong) at
// every call site.

import {
  sshConfigHosts,
  sshConfigResolve,
  sshHostAdd,
  sshHostConnect,
  sshHostDisconnect,
  sshHostInventory,
  sshHostRemove,
  sshHostTrust,
  sshHostsConnected,
  sshHostsList,
} from "$lib/api";
import type {
  RemoteShellKind,
  SshConfigAlias,
  SshHost,
  SshHostDraft,
  SshHostInventory,
} from "$lib/types";
import { i18n } from "$lib/i18n";

const msg = (e: unknown) =>
  e && typeof e === "object" && "message" in e
    ? String((e as { message: unknown }).message)
    : String(e);

/** A host key the user has to confirm before anything else can happen. */
export interface PendingHostKey {
  hostId: string;
  label: string;
  fingerprint: string;
  algorithm?: string | null;
}

/** A credential the host asked for. `attempted` is what was already refused, so
 *  the prompt can say *why* it is asking rather than just asking. */
export interface PendingCredential {
  hostId: string;
  label: string;
  kind: "password" | "passphrase";
  /** For a passphrase: which key file. */
  path?: string | null;
  attempted: string[];
}

class HostsStore {
  hosts = $state<SshHost[]>([]);
  /** Host ids with a live session. */
  connected = $state<string[]>([]);
  /** Host ids with an operation in flight, so their row can show it. */
  busy = $state<string[]>([]);
  error = $state<string | null>(null);

  /** Which shell each connected host starts, keyed by host id. Read from the
   *  connect report — an agent's command line is quoted for *that* shell, and
   *  the terminal's `cd` is written in it. Absent until a host is connected. */
  shells = $state<Record<string, RemoteShellKind>>({});

  /** What each connected host reported about itself, keyed by host id. Asked
   *  once per connection: it costs a remote command, and nothing about a
   *  machine changes between two clicks. */
  inventories = $state<Record<string, SshHostInventory>>({});

  /** Aliases found in `~/.ssh/config`, loaded on demand for the import list. */
  configAliases = $state<SshConfigAlias[]>([]);

  /** Set when a host presented a key we have never seen. */
  pendingKey = $state<PendingHostKey | null>(null);
  /** Set when a host asked for a password or a passphrase. */
  pendingCredential = $state<PendingCredential | null>(null);
  /** Set when a host's key does **not** match what we have on file. Not a
   *  prompt: there is nothing to confirm, only something to be told. */
  keyMismatch = $state<{ hostId: string; label: string; presented: string; stored: string } | null>(
    null,
  );

  isConnected(id: string): boolean {
    return this.connected.includes(id);
  }

  isBusy(id: string): boolean {
    return this.busy.includes(id);
  }

  labelOf(id: string): string {
    return this.hosts.find((h) => h.id === id)?.label ?? id;
  }

  async load(): Promise<void> {
    try {
      this.hosts = await sshHostsList();
      this.connected = await sshHostsConnected();
    } catch (e) {
      this.error = msg(e);
    }
  }

  /** The `Host` aliases in the user's SSH config, for the import list. */
  async loadConfigAliases(): Promise<void> {
    try {
      this.configAliases = await sshConfigHosts();
    } catch (e) {
      this.error = msg(e);
    }
  }

  /** Whether an alias is already registered, so the import list can say so
   *  instead of letting the user add the same machine twice. */
  isAliasRegistered(alias: string): boolean {
    return this.hosts.some((h) => h.configHost?.toLowerCase() === alias.toLowerCase());
  }

  async add(draft: SshHostDraft): Promise<SshHost | null> {
    this.error = null;
    try {
      const added = await sshHostAdd(draft);
      await this.load();
      return added.host;
    } catch (e) {
      this.error = msg(e);
      return null;
    }
  }

  /** Register a host from an alias, letting OpenSSH resolve what it means. */
  async addFromAlias(alias: string): Promise<SshHost | null> {
    this.error = null;
    try {
      const resolved = await sshConfigResolve(alias);
      return await this.add({
        label: alias,
        configHost: alias,
        hostname: resolved.hostname,
        port: resolved.port,
        user: resolved.user,
        identityFiles: resolved.identityFiles,
        identityAgent: resolved.identityAgent,
        identitiesOnly: resolved.identitiesOnly,
        forwardAgent: resolved.forwardAgent,
        proxyCommand: resolved.proxyCommand,
        proxyJump: resolved.proxyJump,
        source: "sshConfig",
      });
    } catch (e) {
      this.error = msg(e);
      return null;
    }
  }

  async remove(hostId: string): Promise<void> {
    this.error = null;
    try {
      await sshHostRemove(hostId);
      await this.load();
    } catch (e) {
      this.error = msg(e);
    }
  }

  /** Reach a host and take it as far as it will go. Every outcome that needs
   *  the user lands in one of the `pending*` fields for the UI to raise. */
  async connect(hostId: string, password?: string): Promise<void> {
    if (this.isBusy(hostId)) return;
    this.error = null;
    this.busy = [...this.busy, hostId];
    try {
      const report = await sshHostConnect(hostId, password);
      const label = this.labelOf(hostId);
      switch (report.status) {
        case "connected":
          this.connected = await sshHostsConnected();
          if (report.shell) {
            this.shells = { ...this.shells, [hostId]: report.shell };
          }
          this.pendingKey = null;
          this.pendingCredential = null;
          void this.loadInventory(hostId);
          break;
        case "hostUnknown":
          this.pendingKey = {
            hostId,
            label,
            fingerprint: report.fingerprint ?? "",
            // The connect report does not carry the algorithm; the dialog shows
            // the fingerprint, which is what the user actually compares.
            algorithm: null,
          };
          break;
        case "hostChanged":
          this.keyMismatch = {
            hostId,
            label,
            presented: report.fingerprint ?? "",
            stored: report.storedFingerprint ?? "",
          };
          break;
        case "hostRevoked":
          this.error = i18n.t("hosts.errRevoked", { host: label });
          break;
        case "needsPassword":
          this.pendingCredential = { hostId, label, kind: "password", attempted: report.attempted };
          break;
        case "needsPassphrase":
          this.pendingCredential = {
            hostId,
            label,
            kind: "passphrase",
            path: report.path,
            attempted: report.attempted,
          };
          break;
        case "failed":
          this.error = report.attempted.length
            ? i18n.t("hosts.errRefusedWhat", { host: label, attempted: report.attempted.join(", ") })
            : i18n.t("hosts.errRefused", { host: label });
          break;
        case "noUsableMethod":
          this.error = i18n.t("hosts.errNoMethod", { host: label });
          break;
      }
      // A host that let us in (or asked for something) may have flipped its
      // "needs a prompt" flag, which the backend persists.
      this.hosts = await sshHostsList();
    } catch (e) {
      this.error = msg(e);
    } finally {
      this.busy = this.busy.filter((id) => id !== hostId);
    }
  }

  /** Record the key the user just confirmed, then carry on connecting — the
   *  point of confirming was to get in, so making them press connect again
   *  would be a step for the app's benefit, not theirs. */
  async trustPendingKey(): Promise<void> {
    const pending = this.pendingKey;
    if (!pending) return;
    this.pendingKey = null;
    try {
      await sshHostTrust(pending.hostId);
    } catch (e) {
      this.error = msg(e);
      return;
    }
    await this.connect(pending.hostId);
  }

  /** Answer the credential a host asked for, and continue. The value is passed
   *  straight through to one attempt; nothing keeps it. */
  async submitPendingCredential(secret: string): Promise<void> {
    const pending = this.pendingCredential;
    if (!pending) return;
    this.pendingCredential = null;
    await this.connect(pending.hostId, secret);
  }

  /** Ask a connected host what it has. Failure is not surfaced as an error:
   *  the session is fine, we just know less about it, and an error banner for a
   *  host that connected perfectly would be a lie about what went wrong. */
  async loadInventory(hostId: string): Promise<void> {
    try {
      const inventory = await sshHostInventory(hostId);
      this.inventories = { ...this.inventories, [hostId]: inventory };
    } catch {
      // Deliberately quiet — see above.
    }
  }

  /** Which shell a host starts, or `undefined` when it is not connected or its
   *  answer was not recognisable. `undefined` means **do not assume** — never a
   *  default. The `unknown` wire value is deliberately collapsed into it so a
   *  caller cannot accidentally quote for a shell nobody identified. */
  shellOf(hostId: string): "posix" | "cmd" | "powershell" | undefined {
    const kind = this.shells[hostId];
    return kind === undefined || kind === "unknown" ? undefined : kind;
  }

  async disconnect(hostId: string): Promise<void> {
    this.error = null;
    try {
      await sshHostDisconnect(hostId);
      this.connected = await sshHostsConnected();
      // A reconnect asks both again: the machine may be configured differently.
      const { [hostId]: _shell, ...shells } = this.shells;
      this.shells = shells;
      const { [hostId]: _dropped, ...rest } = this.inventories;
      this.inventories = rest;
    } catch (e) {
      this.error = msg(e);
    }
  }

  dismissKeyMismatch(): void {
    this.keyMismatch = null;
  }
}

export const hosts = new HostsStore();
