# Auth rebuild — 24h post-deploy soak runbook

After each auth ship (Ship 2..6), run this checklist 24 hours after the deploy.
Pass condition: **zero** rows for any of the three regression classes below.

## 1. The Vichea invariant — client_session_write_failed must never punish the user

```sql
-- Any row here is a P0 regression.
SELECT created_at, actor_user_id, kind, payload
FROM   ops_events
WHERE  created_at > now() - interval '24 hours'
  AND  kind = 'auth_engine.client_session_write_failed'
  AND  (payload ? 'lockout_incremented'
        OR payload ? 'rate_limit_incremented'
        OR payload ? 'captcha_failure_counted');
```

## 2. Post-reset still-locked loop

```sql
-- A successful reset followed by a "still locked" sign-in within 5 minutes
-- for the same email. Should be empty.
WITH resets AS (
  SELECT actor_user_id, created_at AS reset_at, payload->>'email' AS email
  FROM   ops_events
  WHERE  kind = 'auth_engine.reset_succeeded'
    AND  created_at > now() - interval '24 hours'
)
SELECT r.email, r.reset_at, e.created_at AS locked_at
FROM   resets r
JOIN   ops_events e
  ON   e.kind = 'auth_engine.sign_in_blocked'
 AND   e.payload->>'reason' IN ('device_lockout', 'rate_limited', 'captcha_required')
 AND   e.payload->>'email' = r.email
 AND   e.created_at BETWEEN r.reset_at AND r.reset_at + interval '5 minutes';
```

## 3. Captcha failure → page-refresh required

```sql
-- captcha_failed events that were NOT followed by a captcha_reset within 2s.
-- Should be empty (engine resets the widget in-place).
WITH fails AS (
  SELECT id, created_at, payload->>'session_id' AS sid
  FROM   ops_events
  WHERE  kind = 'auth_engine.captcha_failed'
    AND  created_at > now() - interval '24 hours'
)
SELECT f.created_at, f.sid
FROM   fails f
WHERE  NOT EXISTS (
  SELECT 1 FROM ops_events r
  WHERE  r.kind = 'auth_engine.captcha_reset'
    AND  r.payload->>'session_id' = f.sid
    AND  r.created_at BETWEEN f.created_at AND f.created_at + interval '2 seconds'
);
```

## 4. Legacy importer guard (CI smoke)

```bash
# Should be empty after Ship 5 deletion lands.
rg -n "AuthService|auth-lockout|auth-captcha|auth-error-classifier|TurnstileChallenge|sign-in-password\\.flow|use-auth-machine" src \
  --glob '!src/features/auth/**' \
  --glob '!src/services/auth.service.ts' \
  --glob '!src/test/**'
```

## 5. Audit_log noise check

```sql
SELECT changed_fields, count(*)
FROM   audit_log
WHERE  created_at > now() - interval '24 hours'
  AND  action LIKE 'auth_%'
  AND  changed_fields ? 'severity'
  AND  changed_fields->>'severity' = 'error'
GROUP  BY 1
ORDER  BY 2 DESC
LIMIT  20;
```

Any new fingerprint that wasn't present 24h before the deploy = investigate.

---

**Owner:** whoever shipped the auth change.
**Cadence:** run at T+1h, T+6h, T+24h after each Ship 2..6.
**Escalation:** any non-empty result on §1, §2, or §3 → roll back the ship.
