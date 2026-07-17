import { timingSafeEqual } from 'node:crypto';

/** Constant-time string compare that never throws on length mismatch. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
