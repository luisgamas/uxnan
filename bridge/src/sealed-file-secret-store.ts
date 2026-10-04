/**
 * A {@link SecretStore} in one file, sealed with AES-256-GCM under a key the
 * bridge is handed when it starts and never stores.
 *
 * For a bridge with no persistent OS keychain — a remote host, where the only
 * keyring is the kernel's, which a reboot clears (`uxnandesktop/architecture/
 * 02g` §5.18). Uxnan Desktop keeps that host's key in its own OS keychain and
 * the host engine hands it over on standard input (`start --secret-key-stdin`),
 * so the identity outlives a reboot and is never on disk in the clear.
 *
 * A file that does not open with the key given is refused, never replaced: a
 * fresh identity in its place would silently unpair every phone. The first
 * open copies what the keychain already held, so moving to this store keeps
 * the identity the bridge had.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SecretStore } from './secret-store.js';

/** Every secret the bridge keeps, by key — what a first open copies over. */
export const BRIDGE_SECRET_KEYS = [
  'secure-device-state',
  'metrics-seal-key',
  'relay.cloudflare-token',
] as const;

/** The file did not open with the key it was given. */
export class SealedSecretsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealedSecretsError';
  }
}

interface SealedFile {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

/** A 32-byte key from the 64 hex digits it travels as. */
export function parseSecretKey(hex: string): Buffer {
  const trimmed = hex.trim();
  if (!/^[0-9a-f]{64}$/i.test(trimmed)) {
    throw new SealedSecretsError('the secret key must be 64 hex digits');
  }
  return Buffer.from(trimmed, 'hex');
}

export class SealedFileSecretStore implements SecretStore {
  readonly #path: string;
  readonly #key: Buffer;
  readonly #secrets: Map<string, string>;
  #writing: Promise<void> = Promise.resolve();

  private constructor(path: string, key: Buffer, secrets: Map<string, string>) {
    this.#path = path;
    this.#key = key;
    this.#secrets = secrets;
  }

  /**
   * Open the store at [path] with [key]. A missing file starts from what
   * [migrateFrom] holds (the keychain the bridge used before), if given.
   */
  static async open(
    path: string,
    key: Buffer,
    migrateFrom?: SecretStore,
  ): Promise<SealedFileSecretStore> {
    let raw: string | undefined;
    try {
      raw = await readFile(path, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    if (raw !== undefined) {
      return new SealedFileSecretStore(path, key, unseal(raw, key));
    }
    const secrets = new Map<string, string>();
    if (migrateFrom) {
      for (const name of BRIDGE_SECRET_KEYS) {
        const value = await migrateFrom.get(name).catch(() => null);
        if (value !== null) secrets.set(name, value);
      }
    }
    const store = new SealedFileSecretStore(path, key, secrets);
    await store.#save();
    return store;
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.#secrets.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.#secrets.set(key, value);
    return this.#save();
  }

  delete(key: string): Promise<void> {
    if (!this.#secrets.delete(key)) return Promise.resolve();
    return this.#save();
  }

  /** Writes are serialized: the last one always carries every change. */
  #save(): Promise<void> {
    this.#writing = this.#writing.then(() => this.#write()).catch(() => this.#write());
    return this.#writing;
  }

  async #write(): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const tmp = `${this.#path}.tmp`;
    await writeFile(tmp, seal(this.#secrets, this.#key), { encoding: 'utf-8', mode: 0o600 });
    await chmod(tmp, 0o600).catch(() => undefined);
    await rename(tmp, this.#path);
  }
}

function seal(secrets: Map<string, string>, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(Object.fromEntries(secrets)), 'utf-8');
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  const file: SealedFile = {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
  return JSON.stringify(file);
}

function unseal(raw: string, key: Buffer): Map<string, string> {
  let file: SealedFile;
  try {
    file = JSON.parse(raw) as SealedFile;
  } catch {
    throw new SealedSecretsError('the sealed secrets file is not one');
  }
  if (file.v !== 1 || !file.iv || !file.tag || !file.data) {
    throw new SealedSecretsError('the sealed secrets file is not one');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(file.tag, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(file.data, 'base64')),
      decipher.final(),
    ]).toString('utf-8');
    const entries = JSON.parse(plain) as Record<string, unknown>;
    return new Map(
      Object.entries(entries).filter((e): e is [string, string] => typeof e[1] === 'string'),
    );
  } catch {
    throw new SealedSecretsError(
      'the sealed secrets file does not open with the key given — it was sealed by another computer',
    );
  }
}
