/**
 * Abstraction over secret storage. The bridge's Ed25519 private identity is a
 * secret and (per AGENTS.md) must never be written to disk in plaintext.
 *
 * This module ships an in-memory implementation only. A persistent, OS-keychain
 * backed implementation is required before real pairing.
 *
 * FOR-DEV: implement an OS-keychain-backed SecretStore (Windows Credential
 * Manager / macOS Keychain / libsecret) so the bridge identity survives restarts
 * (src/secret-store.ts). Unblocks: real pairing & trusted reconnect.
 */

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Process-lifetime secret store. Secrets are lost when the process exits. */
export class InMemorySecretStore implements SecretStore {
  readonly #secrets = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.#secrets.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.#secrets.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.#secrets.delete(key);
    return Promise.resolve();
  }
}
