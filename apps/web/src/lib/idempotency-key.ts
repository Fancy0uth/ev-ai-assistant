/**
 * A client-generated key identifies one intended side effect.  It is not a
 * credential and is only forwarded by the Core BFF for approved write paths.
 */
export function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('Secure idempotency key generation is unavailable');
  }
  return `web-${globalThis.crypto.randomUUID()}`;
}
