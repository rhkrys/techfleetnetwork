-- Epic 03 — enforce the Gumroad allowlist on cohort registration links at the
-- database layer.
--
-- WHY: `registration_url` is free text supplied by teachers and is about to be
-- rendered to ANONYMOUS visitors on the public course catalog. An arbitrary
-- URL there is an open-redirect / phishing surface pointed at from the Tech
-- Fleet domain. The 2026-08 audit already flagged that a cohort owner can swap
-- this field to an arbitrary external link mid-review. Client-side zod
-- validation (src/lib/validators/gumroad.ts) is the first gate; this constraint
-- is the one that cannot be bypassed by a direct PostgREST write.
--
-- WHY AN ANCHORED REGEX IS SAFE HERE (Postgres has no URL parser):
-- the pattern is anchored at the start AND requires a '/' immediately after
-- the host, which defeats the two classic host-confusion bypasses:
--   https://techfleet.gumroad.com.evil.com/...  -> '.' follows the host, no match
--   https://techfleet.gumroad.com@evil.com/...  -> '@' follows the host, no match
-- The application layer still parses with `new URL()` rather than matching a
-- pattern; this is the defense-in-depth backstop, not the primary check.
--
-- WHY `NOT VALID`: existing cohorts may hold non-Gumroad registration links
-- (Eventbrite, Google Forms, etc.) from before this policy. NOT VALID applies
-- the constraint to every INSERT and UPDATE from now on while leaving historical
-- rows untouched, so this migration cannot fail on deploy and cannot break an
-- unrelated write to an old row. Once those rows are audited and migrated, a
-- follow-up runs:
--     ALTER TABLE public.cohorts VALIDATE CONSTRAINT cohorts_registration_url_gumroad;
-- Until then, the public serializer must not assume historical rows comply.

ALTER TABLE public.cohorts
  DROP CONSTRAINT IF EXISTS cohorts_registration_url_gumroad;

ALTER TABLE public.cohorts
  ADD CONSTRAINT cohorts_registration_url_gumroad
  CHECK (registration_url ~ '^https://techfleet\.gumroad\.com/')
  NOT VALID;

-- The member discount link gets the same host rule. Its https-only CHECK from
-- migration 20260828180000 is now subsumed by this stricter pattern, but is
-- left in place: it is harmless, and dropping it would widen the window if this
-- constraint were ever rolled back.
ALTER TABLE public.cohorts
  DROP CONSTRAINT IF EXISTS cohorts_discount_registration_url_gumroad;

ALTER TABLE public.cohorts
  ADD CONSTRAINT cohorts_discount_registration_url_gumroad
  CHECK (
    discount_registration_url IS NULL
    OR discount_registration_url ~ '^https://techfleet\.gumroad\.com/'
  )
  NOT VALID;
