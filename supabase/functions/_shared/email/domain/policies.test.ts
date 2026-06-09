// Email v2 domain — contract tests. No I/O, no DB, no provider.
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  routeLane, nextBackoffSeconds, permitLane, applyOutcome, comparePriority, LANE_PRIORITY,
} from './policies.ts';
import { DEFAULT_POLICY, type CircuitBreakerSnapshot } from './types.ts';

const cfg = DEFAULT_POLICY;
const baseSnap = (): CircuitBreakerSnapshot => ({
  state: 'closed', recent429Count: 0, consecutiveSuccess: 0, pausedByAdmin: false,
});

Deno.test('routeLane — auth templates → auth', () => {
  for (const t of ['signup','magiclink','recovery','invite','email_change','reauthentication']) {
    assertEquals(routeLane(t), 'auth');
  }
});
Deno.test('routeLane — bulk templates → bulk', () => {
  for (const t of ['project-blast','fleety-coach-digest','announcement']) {
    assertEquals(routeLane(t), 'bulk');
  }
});
Deno.test('routeLane — default → transactional', () => {
  for (const t of ['welcome','interview-scheduled','contact-confirmation']) {
    assertEquals(routeLane(t), 'transactional');
  }
});

Deno.test('nextBackoffSeconds — workspace-quota capped at 120s even with huge provider hint', () => {
  const s = nextBackoffSeconds({ attempt: 1, providerRetryAfterSeconds: 3600, workspaceQuota: true, cfg });
  assertEquals(s, 120);
});
Deno.test('nextBackoffSeconds — non-workspace honors provider hint up to 900s', () => {
  assertEquals(nextBackoffSeconds({ attempt: 1, providerRetryAfterSeconds: 600, workspaceQuota: false, cfg }), 600);
  assertEquals(nextBackoffSeconds({ attempt: 1, providerRetryAfterSeconds: 3600, workspaceQuota: false, cfg }), 900);
});
Deno.test('nextBackoffSeconds — exponential growth', () => {
  const s1 = nextBackoffSeconds({ attempt: 1, workspaceQuota: false, cfg });
  const s3 = nextBackoffSeconds({ attempt: 3, workspaceQuota: false, cfg });
  assert(s3 > s1);
});

Deno.test('permitLane — paused blocks regardless of state', () => {
  const d = permitLane({ ...baseSnap(), pausedByAdmin: true }, new Date());
  assertEquals(d.permit, false);
});
Deno.test('permitLane — closed permits', () => {
  assertEquals(permitLane(baseSnap(), new Date()).permit, true);
});
Deno.test('permitLane — open with future probe blocks', () => {
  const now = new Date();
  const d = permitLane({ ...baseSnap(), state: 'open',
    probeAt: new Date(now.getTime() + 30_000) }, now);
  assertEquals(d.permit, false);
});
Deno.test('permitLane — open with past probe transitions to half_open', () => {
  const now = new Date();
  const d = permitLane({ ...baseSnap(), state: 'open',
    probeAt: new Date(now.getTime() - 1_000) }, now);
  assertEquals(d.permit, true);
});

Deno.test('applyOutcome — 3 workspace-quota 429s within window open the breaker', () => {
  let snap = baseSnap();
  const now = new Date('2026-01-01T00:00:00Z');
  for (let i = 0; i < 3; i++) {
    snap = applyOutcome(snap, { kind: 'rate_limited', statusCode: 429,
      retryAfterSeconds: 60, workspaceQuota: true }, cfg, new Date(now.getTime() + i * 1000));
  }
  assertEquals(snap.state, 'open');
  assert(snap.probeAt instanceof Date);
});
Deno.test('applyOutcome — successes in half_open close the breaker after threshold', () => {
  let snap: CircuitBreakerSnapshot = { ...baseSnap(), state: 'half_open' };
  for (let i = 0; i < cfg.cbCloseSuccessThreshold; i++) {
    snap = applyOutcome(snap, { kind: 'sent', statusCode: 200 }, cfg, new Date());
  }
  assertEquals(snap.state, 'closed');
  assertEquals(snap.recent429Count, 0);
});
Deno.test('applyOutcome — 429s outside the window reset the counter', () => {
  let snap = applyOutcome(baseSnap(), { kind: 'rate_limited', statusCode: 429,
    retryAfterSeconds: 60, workspaceQuota: false }, cfg, new Date('2026-01-01T00:00:00Z'));
  snap = applyOutcome(snap, { kind: 'rate_limited', statusCode: 429,
    retryAfterSeconds: 60, workspaceQuota: false }, cfg,
    new Date('2026-01-01T01:00:00Z'));   // > window
  assertEquals(snap.recent429Count, 1);
});

Deno.test('fairness — auth before transactional before bulk', () => {
  assertEquals(LANE_PRIORITY.auth, 1);
  assert(comparePriority('auth','transactional') < 0);
  assert(comparePriority('transactional','bulk') < 0);
});
