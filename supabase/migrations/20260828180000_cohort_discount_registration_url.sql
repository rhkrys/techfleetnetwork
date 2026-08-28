-- Epic 03 — two-tier course registration links.
--
-- Context: `registration_url` currently points at a Gumroad link with an
-- automatic discount baked in. That discount is moving behind the code
-- `tfmember`, so the two audiences need two different links:
--
--   registration_url          -> PUBLIC list-price link. Already exists, and is
--                                what the anonymous course catalog will show.
--   discount_registration_url -> MEMBER link (base URL + /tfmember). Shown only
--                                to signed-in users.
--
-- SECURITY — why the REVOKE below is not optional.
-- The `anon` role holds broad column-level SELECT on public.cohorts: the
-- "Public can view published cohorts of published classes" policy is
-- column-blind (USING (status = 'published') with no column restriction), so
-- every column of a published cohort is anon-readable by default. The existing
-- `REVOKE SELECT (meeting_url) ON public.cohorts FROM anon` (migration
-- 20260513041024) is the precedent: a per-column revoke is how this schema
-- keeps a cohort column private without touching the RLS policy.
--
-- Without the REVOKE, adding this column would publish the member discount URL
-- to any anonymous PostgREST reader the moment the migration ran — the
-- "member-only" discount would be public on day one. The column is created and
-- locked down in the SAME migration so there is no window where it is exposed.

ALTER TABLE public.cohorts
  ADD COLUMN IF NOT EXISTS discount_registration_url TEXT;

COMMENT ON COLUMN public.cohorts.discount_registration_url IS
  'Member-only Gumroad registration URL (base link + discount code). NEVER returned by public/anonymous endpoints — see the anon REVOKE below and the public-classes serializer.';

-- Mirror the https-only guard already enforced on registration_url by the
-- cohorts validation trigger (migration 20260502160222:199). A CHECK is used
-- here rather than editing that trigger so this migration stays additive.
ALTER TABLE public.cohorts
  DROP CONSTRAINT IF EXISTS cohorts_discount_registration_url_https;

ALTER TABLE public.cohorts
  ADD CONSTRAINT cohorts_discount_registration_url_https
  CHECK (
    discount_registration_url IS NULL
    OR discount_registration_url LIKE 'https://%'
  );

-- Strategy mirrors cohorts_meeting_url_public: column-level privilege revoke for
-- the anon role. Leaves the RLS policy byte-for-byte identical while preventing
-- unauthenticated clients from selecting the member discount link. The
-- authenticated role retains access via the existing policies.
REVOKE SELECT (discount_registration_url) ON public.cohorts FROM anon;
