/**
 * OS-keychain-backed {@link SecretStore} (Windows Credential Manager, macOS
 * Keychain, Linux Secret Service) via the optional `@napi-rs/keyring` native
 * module. The bridge's Ed25519 identity is a secret and (per AGENTS.md) must
 * never be persisted in plaintext — this is how it survives restarts.
 *
 * The native module is optional and loaded lazily; if it is unavailable (e.g. a
 * headless Linux box with no Secret Service), the caller falls back to an
 * in-memory store via {@link createDefaultSecretStore} — the bridge still runs,
 * but the identity is ephemeral (real pairing then requires the keychain).
 */
import type { SecretStore } from './secret-store.js';
import { InMemorySecretStore } from './secret-store.js';
import type { Logger } from './logger.js';

const SERVICE_NAME = 'uxnan-bridge';

/** Minimal synchronous keychain backend (one entry per service+account). */
export interface KeyringBackend {
  getPassword(service: string, account: string): string | null;
  setPassword(service: string, account: string, password: string): void;
  deletePassword(service: string, account: string): boolean;
}

export class KeyringSecretStore implements SecretStore {
  readonly #backend: KeyringBackend;
  readonly #service: string;

  constructor(backend: KeyringBackend, service: string = SERVICE_NAME) {
    this.#backend = backend;
    this.#service = service;
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.#backend.getPassword(this.#service, key));
  }

  set(key: string, value: string): Promise<void> {
    this.#backend.setPassword(this.#service, key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.#backend.deletePassword(this.#service, key);
    return Promise.resolve();
  }
}

/**
 * Lazily load `@napi-rs/keyring` and adapt it to {@link KeyringBackend}.
 * Returns `null` if the module (or its native binary) is unavailable.
 */
export async function loadNativeKeyringBackend(): Promise<KeyringBackend | null> {
  try {
    const mod = (await import('@napi-rs/keyring')) as {
      Entry: new (
        service: string,
        account: string,
      ) => {
        getPassword(): string | null;
        setPassword(password: string): void;
        deletePassword(): boolean;
      };
    };
    const { Entry } = mod;
    return {
      getPassword: (service, account) => {
        try {
          return new Entry(service, account).getPassword();
        } catch {
          return null; // no entry / locked keychain
        }
      },
      setPassword: (service, account, password) => {
        new Entry(service, account).setPassword(password);
      },
      deletePassword: (service, account) => {
        try {
          return new Entry(service, account).deletePassword();
        } catch {
          return false;
        }
      },
    };
  } catch {
    return null;
  }
}

/**
 * Build the default secret store: the OS keychain when available, otherwise a
 * warned in-memory fallback.
 */
export async function createDefaultSecretStore(logger?: Logger): Promise<SecretStore> {
  const backend = await loadNativeKeyringBackend();
  if (backend) {
    return new KeyringSecretStore(backend);
  }
  logger?.warn(
    'OS keychain unavailable (@napi-rs/keyring not loaded); using an in-memory ' +
      'identity store. The bridge identity will NOT survive restarts — install a ' +
      'working keychain before real pairing. See bridge/FOR-DEV.md.',
  );
  return new InMemorySecretStore();
}
