/**
 * Encrypted transport envelope (AES-256-GCM).
 *
 * Source: architecture/02a-system-architecture.md §5.9.1 (Phase 3).
 */

export interface SecureEnvelope {
  kind: 'encryptedEnvelope';
  /**
   * Session this envelope belongs to. Travels in the clear (the receiver needs
   * it before it can look up a key) and is therefore bound as GCM AAD — see
   * {@link seq}.
   */
  sessionId: string;
  /**
   * Monotonic sequence number (replay protection). Like `sessionId` it is
   * visible on the wire, so from `SECURE_PROTOCOL_VERSION` 2 both are bound —
   * together with a direction byte — as the AES-GCM **AAD**:
   *
   *   AAD = utf8(sessionId) || 0x00 || u64_be(seq) || 0x00 || direction
   *
   * so tampering with either field fails the tag instead of silently passing an
   * unauthenticated `seq <= lastApplied` check. Both implementations must build
   * this byte-for-byte identically (`buildEnvelopeAad` on each side); see
   * architecture/02a §5.9.1.
   */
  seq: number;
  /** Per-message random nonce (hex, 12 bytes). */
  nonce: string;
  /** base64 AES-256-GCM ciphertext. */
  ciphertext: string;
  /** base64 GCM auth tag (16 bytes). */
  tag: string;
}
