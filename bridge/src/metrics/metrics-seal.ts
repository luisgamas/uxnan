/**
 * Tamper-proof sealing for the metrics backup file.
 *
 * The export file must be impossible for a user to fabricate or edit (so nobody
 * can inject fake profile stats). That property comes from a **secret the user
 * never holds** — a 32-byte key kept in the PC's OS keychain (see
 * {@link MetricsService}). The events are encrypted with AES-256-GCM under that
 * key: only the same bridge can decrypt, and the GCM tag (with the header bound
 * as AAD) makes any edit detectable. Because the sealing key is bridge-secret and
 * never leaves the PC, the file is **same-PC only** by design — a different PC
 * has a different key and rejects it (architecture/02b §1.2).
 *
 * An optional user passphrase adds a second, independent confidentiality layer
 * (scrypt-derived AES-256-GCM) so a leaked file also needs the phrase. The
 * passphrase is NOT what stops forgery — the keychain key is — it only protects a
 * file whose bridge someone else can reach.
 *
 * No cryptographic variants beyond the audited AES-256-GCM + scrypt primitives.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const FORMAT = 'uxnan-metrics-export';
const BLOB_VERSION = 1;
/** scrypt cost params for the optional passphrase layer (~32 MiB, one-shot). */
const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 } as const;

/** Why an {@link openMetrics} attempt failed — the handler maps these to a
 *  user-facing message. */
export type MetricsSealErrorCode =
  | 'malformed'
  | 'foreign-device'
  | 'passphrase-required'
  | 'bad-passphrase'
  | 'tampered';

export class MetricsSealError extends Error {
  readonly code: MetricsSealErrorCode;
  constructor(code: MetricsSealErrorCode, message: string) {
    super(message);
    this.name = 'MetricsSealError';
    this.code = code;
  }
}

interface GcmParts {
  nonceB64: string;
  ciphertextB64: string;
  tagB64: string;
}

interface SealBlob {
  format: string;
  version: number;
  /** The bridge PC's macDeviceId that sealed this (for a clear same-PC error). */
  deviceId: string;
  createdAt: number;
  passphraseProtected: boolean;
  /** scrypt params for the passphrase layer, present only when protected. */
  kdf?: { saltB64: string; N: number; r: number; p: number };
  /** Outer AES-256-GCM (under the keychain seal key), header bound as AAD. */
  enc: GcmParts;
}

/**
 * Canonical header bytes used as AES-GCM AAD, so editing any header field
 * (deviceId, createdAt, the passphrase flag/params) breaks decryption. Built the
 * exact same way on seal and open — a fixed key order — so the AAD matches.
 */
function headerAad(blob: Omit<SealBlob, 'enc'>): Buffer {
  const ordered: Record<string, unknown> = {
    format: blob.format,
    version: blob.version,
    deviceId: blob.deviceId,
    createdAt: blob.createdAt,
    passphraseProtected: blob.passphraseProtected,
  };
  if (blob.kdf) {
    ordered['kdf'] = { saltB64: blob.kdf.saltB64, N: blob.kdf.N, r: blob.kdf.r, p: blob.kdf.p };
  }
  return Buffer.from(JSON.stringify(ordered), 'utf-8');
}

function gcmEncrypt(key: Buffer, plaintext: Buffer, aad?: Buffer): GcmParts {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    nonceB64: nonce.toString('base64'),
    ciphertextB64: ciphertext.toString('base64'),
    tagB64: cipher.getAuthTag().toString('base64'),
  };
}

function gcmDecrypt(key: Buffer, parts: GcmParts, aad?: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts.nonceB64, 'base64'));
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(parts.tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(parts.ciphertextB64, 'base64')),
    decipher.final(),
  ]);
}

export interface SealOptions {
  /** 32-byte keychain seal key (bridge-secret). */
  sealKey: Buffer;
  /** The bridge PC's macDeviceId. */
  deviceId: string;
  now: number;
  /** Optional user passphrase for the extra confidentiality layer. */
  passphrase?: string;
}

/** Seal [payload] into an opaque, tamper-proof blob string. */
export function sealMetrics(payload: Buffer, options: SealOptions): string {
  const { sealKey, deviceId, now, passphrase } = options;
  const usePassphrase = typeof passphrase === 'string' && passphrase.length > 0;

  const header: Omit<SealBlob, 'enc'> = {
    format: FORMAT,
    version: BLOB_VERSION,
    deviceId,
    createdAt: now,
    passphraseProtected: usePassphrase,
  };

  let inner = payload;
  if (usePassphrase) {
    const salt = randomBytes(16);
    const kp = scryptSync(passphrase, salt, SCRYPT.keylen, SCRYPT);
    header.kdf = { saltB64: salt.toString('base64'), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p };
    // The passphrase layer has no AAD; its own GCM tag protects it, and the outer
    // seal (with the header AAD) protects the kdf params.
    inner = Buffer.from(JSON.stringify(gcmEncrypt(kp, payload)), 'utf-8');
  }

  const enc = gcmEncrypt(sealKey, inner, headerAad(header));
  const blob: SealBlob = { ...header, enc };
  return JSON.stringify(blob);
}

export interface OpenOptions {
  sealKey: Buffer;
  /** The bridge PC's macDeviceId (must match the blob's). */
  deviceId: string;
  passphrase?: string;
}

/** Verify + decrypt a blob string back to its payload. Throws {@link MetricsSealError}. */
export function openMetrics(blobString: string, options: OpenOptions): Buffer {
  let blob: SealBlob;
  try {
    blob = JSON.parse(blobString) as SealBlob;
  } catch {
    throw new MetricsSealError('malformed', 'not a valid metrics backup file');
  }
  if (
    blob === null ||
    typeof blob !== 'object' ||
    blob.format !== FORMAT ||
    blob.version !== BLOB_VERSION ||
    typeof blob.deviceId !== 'string' ||
    typeof blob.enc !== 'object'
  ) {
    throw new MetricsSealError('malformed', 'not a valid metrics backup file');
  }
  if (blob.deviceId !== options.deviceId) {
    throw new MetricsSealError(
      'foreign-device',
      'this backup was created on a different PC and can only be restored there',
    );
  }

  const header: Omit<SealBlob, 'enc'> = {
    format: blob.format,
    version: blob.version,
    deviceId: blob.deviceId,
    createdAt: blob.createdAt,
    passphraseProtected: blob.passphraseProtected,
    ...(blob.kdf ? { kdf: blob.kdf } : {}),
  };

  let inner: Buffer;
  try {
    inner = gcmDecrypt(options.sealKey, blob.enc, headerAad(header));
  } catch {
    // Wrong key (foreign file that faked our deviceId) or an edited blob.
    throw new MetricsSealError('tampered', 'the backup file is corrupted or was modified');
  }

  if (!blob.passphraseProtected) return inner;

  if (typeof options.passphrase !== 'string' || options.passphrase.length === 0) {
    throw new MetricsSealError('passphrase-required', 'this backup is passphrase-protected');
  }
  if (!blob.kdf) {
    throw new MetricsSealError('malformed', 'passphrase-protected backup is missing its kdf');
  }
  const kp = scryptSync(
    options.passphrase,
    Buffer.from(blob.kdf.saltB64, 'base64'),
    SCRYPT.keylen,
    {
      N: blob.kdf.N,
      r: blob.kdf.r,
      p: blob.kdf.p,
      maxmem: SCRYPT.maxmem,
    },
  );
  let payload: Buffer;
  try {
    const parts = JSON.parse(inner.toString('utf-8')) as GcmParts;
    payload = gcmDecrypt(kp, parts);
  } catch {
    throw new MetricsSealError('bad-passphrase', 'wrong passphrase for this backup');
  }
  return payload;
}
