// Remote hosts state for Settings → Hosts (Svelte 5 runes).
//
// The connect flow is the whole reason this store exists. Reaching a host can
// end in many different places, and each one is a different thing to ask the
// user — trust this key, replace one that changed, type a password, unlock a
// key file, answer a second factor, or nothing at all — about the host itself
// or a bastion on the way to it. Collapsing them into "connected / failed"
// would push that decision into the component, where it would be re-derived
// (and eventually got wrong) at every call site.

import {
  sshConfigHosts,
  sshConfigResolve,
  sshHostAdd,
  sshHostAnswer,
  sshHostCancel,
  sshHostConnect,
  sshHostDisconnect,
  sshHostInventory,
  sshHostRemove,
  sshHostReplaceKey,
  sshHostTrust,
  sshHostUpdate,
  sshHostsConnected,
  sshHostsResumable,
  sshHostsList,
} from "$lib/api";
import type {
  RemoteShellKind,
  SshChallenge,
  SshConfigAlias,
  SshConnectReport,
  SshHost,
  SshHostDraft,
  SshHostInventory,
  SshSecret,
  SshSessionEnded,
} from "$lib/types";
import { listen } from "@tauri-apps/api/event";
import { fileTree } from "$lib/state/fileTree.svelte";
import { sessions } from "$lib/state/sessions.svelte";
import { terminals } from "$lib/state/terminals.svelte";
import { i18n } from "$lib/i18n";

const msg = (e: unknown) =>
  e && typeof e === "object" && "message" in e
    ? String((e as { message: unknown }).message)
    : String(e);

/** A host key the user has to confirm before anything else can happen.
 *  `label` names the machine that presented it — the host, or a bastion on the
 *  way to it. */
export interface PendingHostKey {
  hostId: string;
  label: string;
  fingerprint: string;
  algorithm?: string | null;
}

/** A credential a hop asked for. `attempted` is what was already refused, so
 *  the prompt can say *why* it is asking rather than just asking. */
export interface PendingCredential {
  hostId: string;
  /** The machine that asked: the host, or a bastion on the way to it. */
  label: string;
  /** Which hop the secret is for (`user@hostname:port`). */
  hopKey: string;
  kind: "password" | "passphrase";
  /** For a passphrase: which key file. */
  path?: string | null;
  /** For a passphrase: the last one given did not open the key. */
  wrong?: boolean;
  attempted: string[];
}

/** A second factor waiting for the person's answers, on a connection the
 *  backend is holding open. */
export interface PendingChallenge {
  hostId: string;
  label: string;
  challenge: SshChallenge;
}

/** The machine a report is about, said so it stands alone: the host, or "the
 *  bastion, on the way to the host". */
function hopLabel(hostLabel: string, report: SshConnectReport): string {
  return report.hop ? i18n.t("hosts.viaHop", { hop: report.hop, host: hostLabel }) : hostLabel;
}

/** How often the connected hosts' latency is re-read (from this machine). */
const LATENCY_REFRESH_MS = 15_000;

/** Where a host stands, as every surface shows it — the sidebar chip, the host
 *  page, a terminal tab. One answer, so they never disagree. */
export type HostState = "connected" | "connecting" | "needsYou" | "offline";

/** The dot each [`HostState`] is drawn with, wherever a host is shown. */
export const HOST_STATE_TONE: Record<HostState, "ok" | "busy" | "warn" | "off"> = {
  connected: "ok",
  connecting: "busy",
  needsYou: "warn",
  offline: "off",
};

class HostsStore {
  hosts = $state<SshHost[]>([]);
  /** Host ids with a live session. */
  connected = $state<string[]>([]);
  /** The `ssh:session-ended` subscription is installed once. */
  private listening = false;
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
  /** Set when a host asked second-factor questions. */
  pendingChallenge = $state<PendingChallenge | null>(null);
  /** Set when a host's key does **not** match what we have on file. Not a
   *  trust prompt: the only way forward is the person saying the change is
   *  theirs (`replaceChangedKey`), and the dialog says what that means. */
  keyMismatch = $state<{ hostId: string; label: string; presented: string; stored: string } | null>(
    null,
  );

  isConnected(id: string): boolean {
    return this.connected.includes(id);
  }

  /** Where `id` stands now ([`HostState`]). Something waiting on the person — a
   *  key to confirm, a password, a second factor, a key that changed — comes
   *  first: until they answer, nothing else will happen. */
  stateOf(id: string): HostState {
    if (
      this.pendingKey?.hostId === id ||
      this.pendingCredential?.hostId === id ||
      this.pendingChallenge?.hostId === id ||
      this.keyMismatch?.hostId === id
    ) {
      return "needsYou";
    }
    if (this.isConnected(id)) return "connected";
    if (this.isBusy(id)) return "connecting";
    return "offline";
  }

  isBusy(id: string): boolean {
    return this.busy.includes(id);
  }

  labelOf(id: string): string {
    return this.hosts.find((h) => h.id === id)?.label ?? id;
  }

  /** Subscribed once: the backend says when a connection ends, instead of the
   *  interface finding out by asking.
   *
   *  Everything about a dropped session was already correct *when asked* — a
   *  listing opens a new channel, a session that ended stops counting as
   *  connected — but with nothing asking, a host that dropped while its panel
   *  was open kept looking connected until the user clicked something, and the
   *  click was how they found out.
   *
   *  The payload is deliberately not trusted for the new state: it says
   *  *something changed*, and the live set is then re-read from the one place
   *  that knows it. Two sources for one fact is how they end up disagreeing. */
  private async startListening(): Promise<void> {
    if (this.listening) return;
    this.listening = true;
    try {
      await listen<SshSessionEnded>("ssh:session-ended", () => {
        void this.refreshSessions();
      });
      // The latency the engines' heartbeats measure, kept current while a host
      // is connected. A question to this machine's backend, never to the host.
      if (typeof setInterval !== "undefined") {
        setInterval(() => {
          if (this.connected.length > 0) void this.refreshSessions();
        }, LATENCY_REFRESH_MS);
      }
    } catch {
      // No Tauri event bus (the plain browser preview) — on-demand only.
      this.listening = false;
    }
  }

  async load(): Promise<void> {
    try {
      void this.startListening();
      this.hosts = await sshHostsList();
      await this.refreshSessions();
    } catch (e) {
      this.error = msg(e);
    }
  }

  /** Re-read which hosts are up and which incarnation each one is.
   *
   *  The answer lands in the shared session registry (`$lib/state/sessions`),
   *  which is where anything outside Settings reads it from — the editor needs
   *  the generation to fence a save, and reaching into this store for it is what
   *  tangled the module graph. */
  private async refreshSessions(): Promise<void> {
    const before = new Set(this.connected);
    const live = await sshHostsConnected();
    sessions.replace(
      live.map((s) => ({ ...s, label: this.labelOf(s.hostId) })),
    );
    this.connected = sessions.connected;
    // Anything that was up and is not any more: tell the panels living on it,
    // here rather than in `disconnect`, because this is the one place that sees
    // the whole live set — so a session that ended on its own is caught by the
    // same path as one the user closed.
    for (const hostId of before) {
      if (!sessions.isConnected(hostId)) fileTree.hostWentAway(hostId);
    }
  }

  /** The connection generation for a host, or `undefined` when it is not
   *  connected. A caller that cannot name the incarnation must not prepare a
   *  mutation — `undefined` is the signal to refuse, never to send a zero. */
  generationOf(hostId: string): number | undefined {
    return sessions.generationOf(hostId);
  }

  /** Bring back the hosts that can be reached without asking the user anything.
   *
   *  Called once at startup. **The backend decides who qualifies**
   *  (`ssh_hosts_resumable`), because the frontend cannot see the half that
   *  matters: a host registered a moment ago is not marked as needing a prompt
   *  either, and reaching one whose key is not on file can only end in the trust
   *  dialog — on screen, unprompted, while the app is still opening. A host left
   *  out is not refused; it connects the moment the user asks.
   *
   *  One already connected is skipped too, so a reload does not reopen what the
   *  backend never dropped.
   *
   *  Failures are deliberately quiet: an unreachable host at startup is an
   *  ordinary state (laptop closed, VPN not up yet), and the panels that need it
   *  already say they are waiting. `connect` records its own error for the
   *  Settings row. */
  async resume(): Promise<void> {
    await this.load();
    let resumable: string[];
    try {
      resumable = await sshHostsResumable();
    } catch (e) {
      this.error = msg(e);
      return;
    }
    const silent = resumable.filter((id) => !this.isConnected(id));
    await Promise.all(silent.map((id) => this.connect(id)));
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

  /** Edit a registered host. */
  async update(hostId: string, draft: SshHostDraft): Promise<SshHost | null> {
    this.error = null;
    try {
      const updated = await sshHostUpdate(hostId, draft);
      await this.load();
      return updated;
    } catch (e) {
      this.error = msg(e);
      return null;
    }
  }

  /** Reach a host and take it as far as it will go. Every outcome that needs
   *  the user lands in one of the `pending*` fields for the UI to raise. */
  async connect(hostId: string, secret?: SshSecret): Promise<void> {
    await this.drive(hostId, () => sshHostConnect(hostId, secret));
  }

  /** Run one step of the connect flow and route its outcome. */
  private async drive(hostId: string, step: () => Promise<SshConnectReport>): Promise<void> {
    if (this.isBusy(hostId)) return;
    this.error = null;
    this.busy = [...this.busy, hostId];
    try {
      const report = await step();
      const hostLabel = this.labelOf(hostId);
      const label = hopLabel(hostLabel, report);
      switch (report.status) {
        case "connected":
          await this.refreshSessions();
          if (report.shell) {
            this.shells = { ...this.shells, [hostId]: report.shell };
          }
          // Anything that came up before this host did is waiting on it: the
          // file tree fills itself in, and a terminal that could not start
          // starts now. Neither should need the user to close it and try again.
          fileTree.retryForHost(hostId);
          terminals.restartFailedOnHost(hostId);
          this.pendingKey = null;
          this.pendingCredential = null;
          this.pendingChallenge = null;
          void this.loadInventory(hostId);
          break;
        case "hostUnknown":
          if (report.strict) {
            // The host's own configuration forbids trusting a new key from
            // anywhere but its known_hosts: show it, offer nothing.
            this.error = i18n.t("hosts.errStrictUnknown", {
              host: label,
              fingerprint: report.fingerprint ?? "",
            });
            break;
          }
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
          this.pendingCredential = {
            hostId,
            label,
            hopKey: report.hopKey ?? "",
            kind: "password",
            attempted: report.attempted,
          };
          break;
        case "needsPassphrase":
          this.pendingCredential = {
            hostId,
            label,
            hopKey: report.hopKey ?? "",
            kind: "passphrase",
            path: report.path,
            wrong: report.wrong,
            attempted: report.attempted,
          };
          break;
        case "needsAnswers":
          if (report.challenge) {
            this.pendingChallenge = { hostId, label, challenge: report.challenge };
          }
          break;
        case "failed":
          this.error = report.attempted.length
            ? i18n.t("hosts.errRefusedWhat", { host: label, attempted: report.attempted.join(", ") })
            : i18n.t("hosts.errRefused", { host: label });
          break;
        case "noUsableMethod":
          this.error = i18n.t("hosts.errNoMethod", { host: label });
          break;
        case "unreachable":
          // The backend says *why* — asleep, no such name, nothing listening —
          // and that sentence names the machine and the port, so it is shown as
          // it is rather than flattened into "could not connect".
          this.error = report.detail ?? i18n.t("hosts.errRefused", { host: label });
          break;
        case "proxyFailed":
          this.error = i18n.t("hosts.errProxy", { host: label, detail: report.detail ?? "" });
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

  /** Answer the credential a host asked for, and continue. The backend keeps
   *  it in memory for this session of the app, so a dropped connection can come
   *  back without asking again; nothing here keeps it. */
  async submitPendingCredential(value: string): Promise<void> {
    const pending = this.pendingCredential;
    if (!pending) return;
    this.pendingCredential = null;
    await this.connect(pending.hostId, {
      kind: pending.kind,
      hopKey: pending.hopKey,
      path: pending.path ?? null,
      value,
    });
  }

  /** Send the person's answers to a second factor, on the connection that is
   *  waiting for them. Nothing keeps them: a code is spent once used. */
  async answerPendingChallenge(answers: string[]): Promise<void> {
    const pending = this.pendingChallenge;
    if (!pending) return;
    this.pendingChallenge = null;
    await this.drive(pending.hostId, () => sshHostAnswer(pending.hostId, answers));
  }

  /** Close a second-factor prompt without answering; the connection that was
   *  waiting is dropped. */
  async cancelPendingChallenge(): Promise<void> {
    const pending = this.pendingChallenge;
    this.pendingChallenge = null;
    if (pending) {
      try {
        await sshHostCancel(pending.hostId);
      } catch {
        // Nothing was waiting any more; there is nothing to undo.
      }
    }
  }

  /** The person says the changed key is theirs (the machine was reinstalled):
   *  replace the record and carry on connecting. */
  async replaceChangedKey(): Promise<void> {
    const mismatch = this.keyMismatch;
    if (!mismatch) return;
    this.keyMismatch = null;
    try {
      await sshHostReplaceKey(mismatch.hostId);
    } catch (e) {
      this.error = msg(e);
      return;
    }
    await this.connect(mismatch.hostId);
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
      await this.refreshSessions();
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
