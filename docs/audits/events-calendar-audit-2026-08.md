# Events Calendar — Enterprise Audit (2026-08-09)

Scope: the community events calendar feature end-to-end — Google Calendar ICS →
`refresh-community-events` → `community_events_cache` → `get-community-events` →
`EventsPage`. Lenses: architecture, performance/scale, security, reliability,
correctness, observability, data lifecycle, testing. Applied skills:
enterprise-architecture-standards, owasp-secure-coding-bdd, sre-operational-readiness,
comprehensive-test-strategy.

---

## 1. Architecture map (as-built)

```
Google Calendar (public ICS, techfleetnetwork@gmail.com)
   9.1 MB · 7,096 VEVENTs · WEEKLY 1488 / YEARLY 30 / MONTHLY 19 / DAILY 11
        │  conditional GET (If-None-Match / If-Modified-Since → 304 fast path)
        ▼
[edge] refresh-community-events   ── auth: exact-match SUPABASE_SERVICE_ROLE_KEY (opaque)
        │  parse VEVENT + RRULE expansion (single pass) · window −1d … +365d
        ▼
public.community_events_cache  (single JSONB row, id = 1)  ◄── SPOF, whole feature
        ▲
        │  pg_cron 'refresh-community-events' (*/10 min)
        │     → public.kick_community_events_refresh()  [SECURITY DEFINER]
        │         reads service-role key from Vault, POSTs the edge fn
        ▼
[edge] get-community-events  (public, verify_jwt=false, WAF + per-IP RL + 60s L1 memo)
        │  hard floor: never serve events started > 1 day ago
        ▼
[web] EventsPage → useCommunityEventsWeek (per-week from/to fetch) → WeekCalendar / List
        └ EventsSyncHealthBanner (admin-only) via RPC get_community_events_health
```

Key property: **serving is decoupled from refreshing** (read path never touches Google).
That is a good design — reads are O(1) off a cached row. Everything below is about the
_refresh_ path and the operational envelope around it.

---

## 2. Root cause of the current outage

The "48-day-stale calendar" was **two stacked faults plus one design flaw**:

- **Fault 1 — cron not scheduled (FIXED today).** After the Supabase cutover to
  `pzvqxdgoztbfikfuifix`, the `refresh-community-events` pg_cron job was never recreated
  (same class as the other cutover cron gaps). Result: _zero_ refresh attempts for 48 days.
  The banner's "last attempt 48d ago" was the tell — a failing-but-firing cron would show a
  recent attempt.

- **Fault 2 — cron→function auth mismatch (ACTIVE).** With the cron restored, the kick now
  reaches the function but is rejected `403 Forbidden`. The function authorizes by a
  **constant-time exact string match** against its runtime `SUPABASE_SERVICE_ROLE_KEY`
  (`_shared/service-role-auth.ts`, tightened in the Aug-8 audit — correct and must not be
  weakened). Every _current_ project key we sent (legacy `service_role` JWT, both
  `sb_secret_…` keys) returns 403, yet a successful refresh (200 → 287 events) demonstrably
  occurred today. That combination means the value the function compares against is **not any
  current dashboard key** — i.e. the deployed function is running with a **stale injected
  service-role key** (from before the cutover / a key change), OR a long-key copy-paste
  corruption masked the one key that matches. Section 5 resolves which, deterministically.

- **Design flaw — the real finding (see Finding A).** The reason a 10-minute config drift
  became a 48-day silent outage _and_ an afternoon of key-guessing is that this trust
  boundary depends on **three byte-identical copies of a rotating secret** with **no
  observability into which copy is stale** and **no alert when sync dies**.

---

## 3. Findings by dimension

### A. Architecture / coupling — **HIGH**

The cron→function call authenticates with the **project service-role key**, which must be
identical across three independently-managed places: the **Vault secret**
(`email_queue_service_role_key`), the **function runtime env** (`SUPABASE_SERVICE_ROLE_KEY`,
platform-injected), and the **dashboard-issued key**. Any rotation or cutover desyncs them,
and the failure is a flat 403 with no indication of _which_ copy drifted. The service-role
key is also far more privileged than this task needs (it grants full DB bypass; the task only
needs "prove you're allowed to trigger a refresh").
→ **Decouple** the trigger credential from the rotating service-role key (Finding A fix, §4 P1).

### B. Reliability — **HIGH**

- **Fail-silent.** When refresh stops (cron gap, 403, config_error), nothing pages. The cache
  serves stale-but-plausible data (recurring events expanded a year forward still render), so
  the feature _looks_ alive while going wrong — exactly what happened. Violates
  "alert on symptoms of user impact."
- **SPOF.** The entire feature hangs off a single row (`id = 1`). Acceptable given it's a
  derived cache, but there is no fallback path if that row is corrupted.
- **Good:** soft-fail on upstream 429/503 (honors Retry-After, keeps serving cache) and the
  90s fetch timeout are correct resilience patterns.

### C. Observability — **HIGH**

`get_community_events_health` RPC + `EventsSyncHealthBanner` exist, but: banner is
**admin-only** and **passive** (you must be looking at the page), there is **no alert / page**,
and there are **no metrics** (refresh success rate, freshness p99, parse duration, event
count trend). Diagnosing this outage required manual SQL spelunking because the layers aren't
independently observable. Define an SLI/SLO: _cache freshness < 20 min, 99% of the time._

### D. Security — **MEDIUM (mostly healthy)**

- Exact-match authorizer is **correct** — do not revert to unsigned-JWT trust.
- `get-community-events` is appropriately public (`verify_jwt=false`) with WAF + per-IP rate
  limit; the source calendar is already public.
- **Over-privilege:** using the service-role key as the trigger credential means a leak of the
  trigger path leaks full DB access. A scoped trigger secret (Finding A) reduces blast radius.
- **Minor PII:** parsed events store `organizerEmail`. Public already, but it is personal data
  — confirm it's needed by the UI; if not, drop it at parse time (data minimization).

### E. Performance / scale — **MEDIUM (adequate)**

- 767 users read from a cached row via a 60s memo + `stale-while-revalidate` — cheap and
  correct at this scale. The earlier "refresh on every page load / full re-parse" idea was
  **correctly rejected**: a 9 MB parse per load, ×767 users, would rate-limit the whole
  community against Google and add latency for zero benefit over a 10-min cron.
- Refresh cost: conditional GET means most ticks are 304 (no parse); only changed feeds pay
  the ~9 MB single-pass parse. Fine.
- **Watch:** `MAX_INSTANCES = 600` and `iterations` caps can silently truncate a very
  high-frequency recurring series; today's data is far under, but truncation is unlogged.

### F. Correctness / bug-free — **MEDIUM**

Recurrence handling covers the common cases but has real gaps:

- **nth-weekday-of-month** (`BYDAY=3TH` on a MONTHLY rule) — ~49 such rules in the live feed.
  The MONTHLY branch ignores `BYDAY` entirely and emits on the DTSTART day-of-month, so these
  land on the **wrong date**. This is the concrete "not 100% of events" case.
- **DST drift:** weekly expansion steps in fixed UTC milliseconds and re-applies
  `getUTCHours()`, so a "5 pm ET weekly" event shifts by an hour across a DST boundary.
- **Floating time without TZID** is treated as UTC — can be off by the organizer's offset.
  These are bounded (a minority of events) but they are the difference between "mostly right"
  and "100% accurate."

### G. Testing — **HIGH (largest gap)**

There is **no automated coverage** of the refresh/parse pipeline, the RRULE expansion, the
cron→function auth contract, or the health RPC. The exact failure we hit (a valid-looking key
rejected by exact match) is untestable today. Minimum: parser unit tests against a fixture
ICS (incl. the nth-weekday and DST cases), a contract test asserting the kick's credential is
accepted by the function, and an e2e smoke on `get-community-events`.

### H. Data lifecycle — **LOW**

Cache is fully derived and reproducible from the source calendar (RPO ≈ 0, RTO = one refresh).
No backup concern. Retention is inherently bounded by the −1d…+365d window.

---

## 4. Remediation plan (prioritized)

| Pri    | Action                                                                                                                                                                                                                                            | Layer           | Outcome                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------- |
| **P0** | Resolve the auth mismatch deterministically (§5): clean exhaustive key probe → if a current key passes, store it; if all current keys cleanly 403, **redeploy the function** to re-inject the current key, then set Vault = current service_role. | config / deploy | Sync restored, self-sustaining.                                     |
| **P1** | **Decouple trigger auth:** dedicated `EVENTS_REFRESH_SECRET` checked by the function, set once, never rotated with the service-role key.                                                                                                          | code + config   | Key rotation / cutover can never silently break the calendar again. |
| **P1** | **Alerting + SLO:** page when `now() − last_successful_sync > 30 min`; SLI = cache freshness, SLO = <20 min 99%. Reuse `get_community_events_health`.                                                                                             | infra/obs       | Fail-loud instead of fail-silent.                                   |
| **P2** | **Parser correctness:** nth-weekday-of-month (BYDAY on MONTHLY), DST-safe weekly stepping, floating-time handling — each with a failing-then-passing test.                                                                                        | code            | True 100% accuracy.                                                 |
| **P2** | **Tests:** parser unit suite (fixture ICS), cron→fn auth contract test, `get-community-events` e2e smoke.                                                                                                                                         | tests/CI        | The failure class becomes regression-covered.                       |
| **P3** | Runbook: "calendar stale" → check banner → check cron row → check `net._http_response` → key/redeploy.                                                                                                                                            | docs            | Faster next incident.                                               |

---

## 5. The one deterministic experiment (ends the key hunt)

No more guessing. Two mutually exclusive hypotheses, one clean test:

- **H-copy:** one current key is correct; earlier 403s were long-key copy corruption.
- **H-stale:** the function's injected key is stale (pre-cutover); _no_ current key matches.

**Test:** probe the function once with each current key, copied via the dashboard **copy
icon** (never hand-selected), each with a captured request id, and read all statuses in one
query.

- If exactly one returns **200** → H-copy. Store that key in Vault. Done.
- If **all** cleanly return **403** → H-stale. The fix is to **redeploy
  `refresh-community-events`** (which re-injects the project's _current_
  `SUPABASE_SERVICE_ROLE_KEY`), then set Vault to the current `service_role` key. After a
  redeploy the function's env and the Vault secret are sourced from the same current key, so
  they match by construction — not by guesswork.

Either branch is deterministic. The redeploy branch (H-stale) also explains, and fixes, why
_every_ current key was rejected: the running code predates the current key set.
