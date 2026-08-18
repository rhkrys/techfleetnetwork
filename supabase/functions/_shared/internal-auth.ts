// Fleety 2.1 — trusted internal-caller check for server-to-server edge calls (e.g. the Discord
// /fleety adapter reaching techfleet-chat). Pure + dependency-free so the security-critical decision
// is unit-tested in isolation. See discord-interactions/fleety-2.1-discord.feature (@security).

/** Constant-time string compare — no early exit that could leak match length via response timing. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/** Minimum secret length to accept — a blank/short env must never be a brute-forceable bypass. */
export const MIN_INTERNAL_SECRET_LEN = 32;

/**
 * Decide whether a request is a trusted internal caller. FAILS CLOSED: returns false unless a
 * secret of adequate length is configured AND the presented header matches it in constant time.
 */
export function isTrustedInternal(
  configuredSecret: string | undefined | null,
  presentedHeader: string | undefined | null
): boolean {
  if (!configuredSecret || configuredSecret.length < MIN_INTERNAL_SECRET_LEN) return false;
  if (!presentedHeader) return false;
  return constantTimeEqual(presentedHeader, configuredSecret);
}
