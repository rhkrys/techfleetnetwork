# Permanent fix: eliminate `rate_limit:workspace:email_send` 429s

## What's happening today

The only 429 in the last 14 days fired on **2026-05-31 19:00 UTC** (`occurrence_count=1`, already auto-resolved by the cooldown). The Triage row the user is seeing is stale.

But the root cause is real: the provider key is **workspace-scoped** (`rate_limit:workspace:email_send:9wtSoOwS1AHHNpYNTGKb`), and every lane (`auth_emails`, `transactional_emails`, `bulk_emails`) plus every concurrent edge isolate shares it. Today we only react **after** a 429:

- per-lane exponential cooldown ✓ (works, but lossy — 62s pause)
- adaptive `send_delay_ms` doubling ✓ (only kicks in after the first 429)
- bulk hourly cap ✓ (per-lane, not workspace)

There is **no proactive throttle** across lanes/isolates. A NOTIFY-burst + a cron tick can put 3 isolates side-by-side, each respecting their own per-lane pace, and collectively breach the workspace cap.

## Fix (permanent, no band-aid)

Introduce a **workspace-wide token bucket** that every send must claim a token from. Tokens regenerate at a rate strictly below the provider cap, and self-tune downward on 429s / upward on sustained success. The cooldown logic stays as a second line of defense, but in steady state it never fires.

### 1. DB: atomic token bucket

New table + 3 SECURITY DEFINER RPCs:

```sql
create table public.email_workspace_throttle (
  id            int primary key default 1,
  tokens        numeric not null default 5,     -- current bucket level
  capacity      numeric not null default 5,     -- burst size
  refill_per_s  numeric not null default 2.0,   -- steady-state cap (req/sec)
  min_refill    numeric not null default 0.5,
  max_refill    numeric not null default 4.0,
  last_refill_at timestamptz not null default now(),
  last_429_at   timestamptz,
  successes_since_429 int not null default 0,
  check (id = 1)
);

-- Returns wait_ms (0 if a token was consumed, >0 if caller should wait).
create function public.consume_workspace_email_token(p_count int default 1)
returns int language plpgsql security definer ...;

create function public.record_workspace_email_429()
returns void language plpgsql security definer ...;  -- halves refill_per_s, clamped to min_refill

create function public.record_workspace_email_success()
returns void language plpgsql security definer ...;  -- after N=500 wins, +10% up to max_refill
```

Singleton row, `FOR UPDATE` lock → atomic across all isolates and lanes. No app-side coordination needed.

### 2. Worker: claim before send

In `supabase/functions/process-email-queue/index.ts`, immediately before every `fetch(EMAIL_API)` call:

```ts
const { data: waitMs } = await supabase.rpc('consume_workspace_email_token');
if ((waitMs ?? 0) > 0) {
  // Bucket empty — leave message in queue, exit the lane cleanly.
  // Cron will retry; NOTIFY trigger debounced to >= 1s.
  break;
}
```

On 200 from the provider → `record_workspace_email_success()`.
On 429 → `record_workspace_email_429()` **in addition to** the existing per-lane cooldown.

Net effect: the worker can never out-run the bucket, regardless of how many isolates are warm.

### 3. Calm the fan-out

- `trg_notify_email_worker_tx` already pokes the worker on every enqueue. Add a 500 ms debounce key in `email_send_state.last_notify_at`; skip NOTIFY if fired within the window.
- Drop default `batch_size` 5 → **3** for transactional, keep bulk at 3. Token bucket is the real cap now; batch size just controls work-per-tick.

### 4. Clean up the stale alert + harden Triage

- Resolve the May-31 `email_rate_limited` row with `dismissed_reason="superseded by workspace token bucket EMAIL-RL-010"`.
- `discover_audit_fingerprints` already honors `severity:*` tags — emit `severity:warn` on workspace-throttle waits (so they never reach Triage) and keep `severity:error` only for actual provider 429s.

### 5. BDD + memory

- New scenarios `EMAIL-RL-010..014`:
  - 010 — bucket empty, worker exits cleanly, message stays queued
  - 011 — 200 streak ratchets `refill_per_s` up to ceiling
  - 012 — 429 halves `refill_per_s` down to floor
  - 013 — concurrent isolates cannot exceed `refill_per_s + capacity`
  - 014 — NOTIFY debounce prevents thundering-herd
- Update `mem://features/email-queue-per-lane-cooldown` and `mem://features/email-lane-isolation` with the new §workspace token bucket section; bump index Core line.

## Files touched

- **New migration** — `email_workspace_throttle` table + 3 RPCs + grants + seed row + 5 BDD scenarios + cleanup of stale Triage row + NOTIFY debounce column.
- `supabase/functions/process-email-queue/index.ts` — token claim before each send, success/429 hooks, NOTIFY debounce check, default batch_size 3.
- `supabase/functions/_shared/transactional-email.ts` — no change (routing unchanged).
- `mem://features/email-queue-per-lane-cooldown`, `mem://features/email-lane-isolation`, `mem://index.md`.
- Redeploy `process-email-queue`.

## Why this is the root-cause fix

The current system **recovers** from 429s. This change makes 429s structurally impossible under normal traffic: every request goes through a single atomic gate whose rate is provably below the provider cap, and that rate self-corrects if the provider ever tightens. The existing per-lane cooldown becomes a belt-and-suspenders fallback that should stay at `consecutive_rate_limits = 0` indefinitely.
