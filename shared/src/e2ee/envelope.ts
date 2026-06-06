/**
 * Encrypted transport envelope (AES-256-GCM).
 *
 * Source: architecture/02a-system-architecture.md §5.9.1 (Phase 3).
 */

export interface SecureEnvelope {
  kind: 'encryptedEnvelope';
  sessionId: string;
  /** Monotonic sequence number (replay protection). */
  seq: number;
  /** Per-message random nonce (hex, 12 bytes). */
  nonce: string;
  /** base64 AES-256-GCM ciphertext. */
  ciphertext: string;
  /** base64 GCM auth tag (16 bytes). */
  tag: string;
}
