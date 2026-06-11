// Email subsystem v2 — pure domain types. No I/O. No Deno. No npm.
// Imported by application + infrastructure layers and unit tests alike.

export type Lane = 'auth' | 'transactional' | 'bulk';

export const LANE_BITMASK: Record<Lane, number> = { auth: 1, transactional: 2, bulk: 4 };

export const BULK_TEMPLATES = new Set<string>([
  'project-blast',
  'fleety-coach-digest',
  'announcement',
]);

export const AUTH_TEMPLATES = new Set<string>([
  'signup', 'magiclink', 'recovery', 'invite', 'email_change', 'reauthentication',
]);

export interface EmailEnvelope {
  lane: Lane;
  template: string;
  recipient: string;
  subject?: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  messageId: string;
  traceId?: string;
}

export type ProviderOutcome =
  | { kind: 'sent'; statusCode: number; providerMessageId?: string }
  | { kind: 'rate_limited'; statusCode: 429; retryAfterSeconds: number; workspaceQuota: boolean; raw?: string }
  | { kind: 'error'; statusCode: number; message: string; retryable: boolean }
  | { kind: 'suppressed'; reason: 'bounced' | 'complained' | 'unsubscribed' | 'manual' }
  | { kind: 'permanent_fail'; statusCode: number; message: string };

export interface CircuitBreakerSnapshot {
  state: 'closed' | 'open' | 'half_open';
  openedAt?: Date;
  probeAt?: Date;
  recent429Count: number;
  recent429WindowStart?: Date;
  consecutiveSuccess: number;
  pausedByAdmin: boolean;
}

export interface PolicyConfig {
  baseBackoffSeconds: number;
  maxBackoffSeconds: number;
  workspaceQuotaCapSeconds: number;
  cbOpenThreshold429s: number;
  cbOpenWindowSeconds: number;
  cbHalfOpenProbeSeconds: number;
  cbCloseSuccessThreshold: number;
  maxBatchSize: number;
  minSendGapMs: number;
  pendingExpiryMinutes: number;
  authPendingExpiryMinutes: number;
}

export const DEFAULT_POLICY: PolicyConfig = {
  baseBackoffSeconds: 60,
  maxBackoffSeconds: 900,
  workspaceQuotaCapSeconds: 120,
  // 2026-06-11 — tightened from 3 → 2 after the 06-01 announcement blast
  // produced 29 vendor 429s before the previous threshold tripped. With the
  // bulk lane now on v2 (bitmask bit 4), opening on the 2nd 429 stops the
  // bleed into auth/recovery lanes that share the workspace token bucket.
  cbOpenThreshold429s: 2,
  cbOpenWindowSeconds: 600,
  cbHalfOpenProbeSeconds: 30,
  cbCloseSuccessThreshold: 5,
  maxBatchSize: 25,
  minSendGapMs: 500,
  pendingExpiryMinutes: 60,
  authPendingExpiryMinutes: 15,
};
