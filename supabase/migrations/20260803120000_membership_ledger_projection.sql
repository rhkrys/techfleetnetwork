-- =============================================================================
-- Membership recognition: event-sourced ledger -> deterministic projection.
--
-- Design: `gumroad_sales` is an append-only LEDGER (source of truth). A single
-- SECURITY DEFINER projector `compute_membership(user_id)` derives the profile's
-- membership_* columns from the ledger + a deterministic product catalog. The
-- profile columns are a DERIVED CACHE and are physically un-writable by anyone
-- except the projector (see guard trigger). This kills: profile-rebuild drift,
-- login-dependent recovery, keyword SKU guessing, and the "member PATCHes their
-- own tier" mass-assignment hole.
--
-- Security posture (OWASP): RLS deny-by-default on ledger + catalog; every
-- SECURITY DEFINER function pins `SET search_path = ''` and fully-qualifies
-- names (SQLi/search-path-hijack); least-privilege GRANT/REVOKE; refunds/disputes
-- downgrade (no refund fraud); idempotent (sale_id unique) so replays are no-ops;
-- founding is a permanent latch decoupled from access; every state transition is
-- audited. Owner rules: founding permanent (distinct pre-2027 SKU); refund/cancel
-- happen on Gumroad and we react to lifecycle events.
--
-- Idempotent / re-runnable: guarded with IF NOT EXISTS / CREATE OR REPLACE / DROP.
-- =============================================================================

-- ── Part A — Ledger lifecycle columns on gumroad_sales ───────────────────────
ALTER TABLE public.gumroad_sales
  ADD COLUMN IF NOT EXISTS subscription_id            text,
  ADD COLUMN IF NOT EXISTS resource_name              text,        -- gumroad event: sale|refund|dispute|cancellation|subscription_ended
  ADD COLUMN IF NOT EXISTS refunded_at                timestamptz,
  ADD COLUMN IF NOT EXISTS disputed_at                timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_cancelled_at  timestamptz, -- scheduled to end; access continues until subscription_ended_at
  ADD COLUMN IF NOT EXISTS subscription_ended_at      timestamptz; -- access revoked from here

CREATE INDEX IF NOT EXISTS idx_gumroad_sales_product_id      ON public.gumroad_sales (product_id);
CREATE INDEX IF NOT EXISTS idx_gumroad_sales_subscription_id ON public.gumroad_sales (subscription_id) WHERE subscription_id IS NOT NULL;

-- gumroad_sales RLS is already deny-by-default (only admin SELECT + service_role
-- ALL exist). Re-assert there is NO write path for authenticated/anon members.
-- (No policy grants them INSERT/UPDATE/DELETE, so RLS denies it. This comment is
-- the invariant; the pgTAP test enforces it.)

-- ── Part B — Deterministic product catalog ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.membership_products (
  product_id     text PRIMARY KEY,                    -- Gumroad stable product id (or a stable slug until known)
  tier           public.membership_tier NOT NULL,
  is_founding    boolean NOT NULL DEFAULT false,
  billing_period text NOT NULL DEFAULT 'monthly' CHECK (billing_period IN ('monthly','yearly')),
  rank           integer NOT NULL DEFAULT 0,          -- higher wins when a member holds several entitlements
  is_active      boolean NOT NULL DEFAULT true,
  notes          text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- A product can be referenced by several permalinks (custom slug + Gumroad short
-- code). Payloads carry product_id (stable) and product_permalink (may be short).
CREATE TABLE IF NOT EXISTS public.membership_product_aliases (
  permalink  text PRIMARY KEY,                        -- lower-cased permalink/slug as it appears in payloads
  product_id text NOT NULL REFERENCES public.membership_products(product_id) ON DELETE CASCADE
);

ALTER TABLE public.membership_products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_product_aliases  ENABLE ROW LEVEL SECURITY;

-- Catalog is non-sensitive product metadata: any authenticated user may READ it;
-- only admins (or service role) may WRITE it.
DROP POLICY IF EXISTS "read membership_products" ON public.membership_products;
CREATE POLICY "read membership_products" ON public.membership_products
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin writes membership_products" ON public.membership_products;
CREATE POLICY "admin writes membership_products" ON public.membership_products
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "read membership_product_aliases" ON public.membership_product_aliases;
CREATE POLICY "read membership_product_aliases" ON public.membership_product_aliases
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin writes membership_product_aliases" ON public.membership_product_aliases;
CREATE POLICY "admin writes membership_product_aliases" ON public.membership_product_aliases
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed the founding SKU (owner-confirmed: community tier, permanent founding,
-- yearly, 50% off, pre-2027). Real Gumroad product_id TBD — keyed on the stable
-- custom slug for now; both known permalink forms alias to it.
INSERT INTO public.membership_products (product_id, tier, is_founding, billing_period, rank, notes)
VALUES ('founding-membership', 'community', true, 'yearly', 100,
        'Founding member SKU (pre-2027, 50% off). Permanent founding status. Replace product_id with the real Gumroad id when known.')
ON CONFLICT (product_id) DO NOTHING;

INSERT INTO public.membership_product_aliases (permalink, product_id) VALUES
  ('founding-membership', 'founding-membership'),
  ('ftpql',              'founding-membership')
ON CONFLICT (permalink) DO NOTHING;

-- ── Part C — Catalog lookup helper ───────────────────────────────────────────
-- Resolve a sale (product_id first, then permalink alias) to its catalog row.
-- RETURNS SETOF so an uncataloged product yields ZERO rows — a LATERAL join then
-- EXCLUDES that sale (Tech Fleet sells other, non-membership Gumroad products;
-- those must grant nothing). STABLE, fully-qualified, pinned search_path.
CREATE OR REPLACE FUNCTION public.membership_catalog_lookup(p_product_id text, p_permalink text)
RETURNS SETOF public.membership_products
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT p.* FROM public.membership_products p
   WHERE p.is_active AND p.product_id = NULLIF(p_product_id, '')
  UNION ALL
  SELECT p.* FROM public.membership_products p
    JOIN public.membership_product_aliases a ON a.product_id = p.product_id
   WHERE p.is_active AND a.permalink = lower(NULLIF(p_permalink, ''))
  LIMIT 1
$$;

-- ── Part D — Profile membership-column guard (mass-assignment defense) ────────
-- membership_* columns are a derived cache with EXACTLY ONE legitimate writer:
-- compute_membership() (which sets app.membership_writer='on' for its txn).
-- Any other attempt to change them — e.g. a member PATCHing /profiles with a
-- stolen/valid JWT, or a buggy service path — is rejected. This enforces the
-- "one writer" invariant at the storage layer, independent of RLS.
CREATE OR REPLACE FUNCTION public.guard_profile_membership_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Authorized projector write (txn-local flag) — always allowed.
  IF COALESCE(current_setting('app.membership_writer', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- New profiles must be born at the default Free status; only the projector
    -- may confer a paid tier (closes the INSERT escalation path).
    IF NEW.membership_tier                       IS DISTINCT FROM 'starter'::public.membership_tier
      OR COALESCE(NEW.is_founding_member, false)        IS DISTINCT FROM false
      OR COALESCE(NEW.membership_billing_period, 'monthly') IS DISTINCT FROM 'monthly'
      OR COALESCE(NEW.membership_sku, '')               IS DISTINCT FROM ''
      OR COALESCE(NEW.membership_gumroad_sale_id, '')   IS DISTINCT FROM ''
    THEN
      RAISE EXCEPTION 'membership_* is derived; a new profile must start at starter'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF ( NEW.membership_tier            IS DISTINCT FROM OLD.membership_tier
    OR NEW.is_founding_member         IS DISTINCT FROM OLD.is_founding_member
    OR NEW.membership_billing_period  IS DISTINCT FROM OLD.membership_billing_period
    OR NEW.membership_sku             IS DISTINCT FROM OLD.membership_sku
    OR NEW.membership_gumroad_sale_id IS DISTINCT FROM OLD.membership_gumroad_sale_id )
  THEN
    RAISE EXCEPTION 'membership_* columns are derived from gumroad_sales and are read-only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_membership ON public.profiles;
CREATE TRIGGER trg_guard_profile_membership
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_membership_columns();

-- ── Part E — The single projector ────────────────────────────────────────────
-- Derives membership_* for one user from the ledger + catalog. Deterministic and
-- idempotent (writes only on change). The ONLY writer of membership_* columns.
CREATE OR REPLACE FUNCTION public.compute_membership(p_user_id uuid)
RETURNS public.membership_tier
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tier     public.membership_tier := 'starter';
  v_founding boolean := false;
  v_billing  text := 'monthly';
  v_sku      text := '';
  v_sale_id  text := '';
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'starter';
  END IF;

  -- Founding latch: ANY founding-product sale that was not refunded AND not
  -- disputed. Cancellation does NOT revoke it (permanent), but a refund or a
  -- won chargeback (dispute) is money clawed back and removes the basis.
  SELECT EXISTS (
    SELECT 1
      FROM public.gumroad_sales gs
      JOIN LATERAL public.membership_catalog_lookup(gs.product_id, gs.product_permalink) c ON true
     WHERE gs.resolved_user_id = p_user_id
       AND c.is_founding
       AND gs.refunded_at IS NULL
       AND gs.disputed_at IS NULL
  ) INTO v_founding;

  -- Access tier: highest-rank ACTIVE entitlement. Active = not refunded, not
  -- disputed, and (for subscriptions) not ended. A cancelled-but-not-yet-ended
  -- subscription still grants access until subscription_ended_at is set.
  SELECT c.tier, c.billing_period,
         COALESCE(NULLIF(gs.product_permalink, ''), gs.product_id), gs.sale_id
    INTO v_tier, v_billing, v_sku, v_sale_id
    FROM public.gumroad_sales gs
    JOIN LATERAL public.membership_catalog_lookup(gs.product_id, gs.product_permalink) c ON true
   WHERE gs.resolved_user_id = p_user_id
     AND gs.refunded_at IS NULL
     AND gs.disputed_at IS NULL
     AND gs.subscription_ended_at IS NULL
   ORDER BY c.rank DESC, gs.received_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    v_tier := 'starter'; v_billing := 'monthly'; v_sku := ''; v_sale_id := '';
  END IF;

  -- Authorize ONLY this derived write, then immediately revoke. The flag is
  -- txn-local; resetting it right after the UPDATE keeps the authorization
  -- window to a single statement so no later write in the same transaction can
  -- ride on it (defense in depth for the column guard).
  PERFORM set_config('app.membership_writer', 'on', true);

  UPDATE public.profiles
     SET membership_tier            = v_tier,
         is_founding_member         = v_founding,
         membership_billing_period  = v_billing,
         membership_sku             = v_sku,
         membership_gumroad_sale_id = v_sale_id,
         membership_updated_at      = now()
   WHERE user_id = p_user_id
     AND ( membership_tier            IS DISTINCT FROM v_tier
        OR is_founding_member         IS DISTINCT FROM v_founding
        OR membership_billing_period  IS DISTINCT FROM v_billing
        OR membership_sku             IS DISTINCT FROM v_sku
        OR membership_gumroad_sale_id IS DISTINCT FROM v_sale_id );

  PERFORM set_config('app.membership_writer', 'off', true);

  RETURN v_tier;
END
$$;

-- ── Part F — Triggers: automatic re-projection ───────────────────────────────
-- Re-project a user whenever their ledger changes (kills login-dependence).
CREATE OR REPLACE FUNCTION public.trg_gumroad_sales_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.resolved_user_id IS NOT NULL THEN
    PERFORM public.compute_membership(NEW.resolved_user_id);
  END IF;
  -- If a sale was re-pointed to a different user, re-project the old one too.
  IF TG_OP = 'UPDATE' AND OLD.resolved_user_id IS NOT NULL
     AND OLD.resolved_user_id IS DISTINCT FROM NEW.resolved_user_id THEN
    PERFORM public.compute_membership(OLD.resolved_user_id);
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_gumroad_sales_project ON public.gumroad_sales;
CREATE TRIGGER trg_gumroad_sales_project
  AFTER INSERT OR UPDATE ON public.gumroad_sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_gumroad_sales_project();

-- Self-heal on profile (re)creation: resolve any pending sales for this email,
-- then project. This restores a paid member after a profile rebuild WITHOUT the
-- member having to log in — the exact prod regression from the migration.
CREATE OR REPLACE FUNCTION public.trg_profile_resolve_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email <> '' THEN
    UPDATE public.gumroad_sales gs
       SET resolved_user_id = NEW.user_id,
           status = 'applied',
           processed_at = now()
     WHERE gs.resolved_user_id IS NULL
       AND lower(gs.email) = lower(NEW.email);   -- fires trg_gumroad_sales_project -> compute_membership
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_profile_resolve_pending ON public.profiles;
CREATE TRIGGER trg_profile_resolve_pending
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_profile_resolve_pending();

-- ── Part G — Admin reattach RPC (email-mismatch orphans) ─────────────────────
-- Bind an already-recorded sale to a chosen user. Admin-gated INSIDE the function
-- (definer bypasses RLS, so authz lives here), audit-logged. Cannot fabricate a
-- sale — only re-point one that already exists.
CREATE OR REPLACE FUNCTION public.attach_gumroad_sale(p_sale_id text, p_user_id uuid)
RETURNS public.membership_tier
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_exists boolean;
BEGIN
  IF NOT public.has_role(v_actor, 'admin') THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_sale_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'sale_id and user_id are required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.gumroad_sales WHERE sale_id = p_sale_id) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'no such sale' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM 1 FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such user' USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE public.gumroad_sales
     SET resolved_user_id = p_user_id, status = 'applied', processed_at = now()
   WHERE sale_id = p_sale_id;   -- fires projection trigger

  PERFORM public.write_audit_log(
    'gumroad_sale_attached', 'gumroad_sales', p_sale_id, v_actor,
    ARRAY['attached_to:' || p_user_id::text], NULL);

  RETURN public.compute_membership(p_user_id);
END
$$;

-- ── Part H — Drift sweep + tripwire (nightly cron target) ────────────────────
-- Re-project every user whose profile disagrees with the ledger, and raise an
-- audit tripwire for any non-starter profile with NO backing active sale
-- (i.e. paid state that did not come from a verified sale — a bug or tampering).
CREATE OR REPLACE FUNCTION public.reproject_membership_drift()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_fixed integer := 0;
  r record;
BEGIN
  -- Tripwire: paid profiles with no active backing sale.
  FOR r IN
    SELECT p.user_id, p.membership_tier
      FROM public.profiles p
     WHERE p.membership_tier <> 'starter'
       AND NOT EXISTS (
         SELECT 1 FROM public.gumroad_sales gs
          WHERE gs.resolved_user_id = p.user_id
            AND gs.refunded_at IS NULL AND gs.disputed_at IS NULL
            AND gs.subscription_ended_at IS NULL)
  LOOP
    PERFORM public.write_audit_log(
      'membership_invariant_violation', 'profiles', r.user_id::text, NULL,
      ARRAY['tier:' || r.membership_tier::text, 'reason:no_backing_active_sale'], NULL);
  END LOOP;

  -- Re-project everyone whose profile differs from the ledger-derived value.
  -- compute_membership() returns the recomputed tier; count tier-level corrections.
  FOR r IN SELECT user_id, membership_tier FROM public.profiles LOOP
    IF public.compute_membership(r.user_id) IS DISTINCT FROM r.membership_tier THEN
      v_fixed := v_fixed + 1;
    END IF;
  END LOOP;
  RETURN v_fixed;
END
$$;

-- ── Part I — Health surface (observability tile source; admin-gated) ─────────
-- A SECURITY DEFINER function (not a view) so it aggregates ALL rows while
-- returning data only to admins — a plain view would either be RLS-limited to
-- the caller's own rows (wrong counts) or leak org-wide aggregates to every
-- authenticated user. The has_role gate in the WHERE yields 0 rows for non-admins.
CREATE OR REPLACE FUNCTION public.membership_health()
RETURNS TABLE (
  last_sale_received_at timestamptz,
  pending_user_count    bigint,
  paid_profile_count    bigint,
  active_backing_sales  bigint,
  invariant_violations  bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (SELECT max(received_at) FROM public.gumroad_sales),
    (SELECT count(*) FROM public.gumroad_sales WHERE status = 'pending_user'),
    (SELECT count(*) FROM public.profiles WHERE membership_tier <> 'starter'),
    (SELECT count(*) FROM public.gumroad_sales
       WHERE resolved_user_id IS NOT NULL AND refunded_at IS NULL
         AND disputed_at IS NULL AND subscription_ended_at IS NULL),
    (SELECT count(*) FROM public.profiles p
       WHERE p.membership_tier <> 'starter'
         AND NOT EXISTS (SELECT 1 FROM public.gumroad_sales gs
                          WHERE gs.resolved_user_id = p.user_id
                            AND gs.refunded_at IS NULL AND gs.disputed_at IS NULL
                            AND gs.subscription_ended_at IS NULL))
  WHERE public.has_role(auth.uid(), 'admin');
$$;

-- ── Part K — Invariant backfill: every account has a definite status ─────────
-- Product rule: no account may have a blank membership status — every active (or
-- inactive) profile is either 'starter' (Free) or a paid tier (Early Career
-- Member = 'community'). membership_tier is already NOT NULL DEFAULT 'starter',
-- so blanks are structurally impossible going forward; this one-time pass (a)
-- normalizes any legacy NULL defensively, (b) resolves sales that were paid
-- BEFORE the buyer's profile existed (pending_user) to their now-existing profile
-- by email, and (c) projects every profile from the ledger so existing paid
-- members are recognized immediately on deploy (not on next login).
-- (Authorize this defensive direct write through the column guard.)
SELECT set_config('app.membership_writer', 'on', true);
UPDATE public.profiles SET membership_tier = 'starter' WHERE membership_tier IS NULL;
SELECT set_config('app.membership_writer', 'off', true);

-- Resolve pending sales to existing profiles by verified email (fires the
-- projection trigger for each newly-resolved paid member).
UPDATE public.gumroad_sales gs
   SET resolved_user_id = p.user_id, status = 'applied', processed_at = now()
  FROM public.profiles p
 WHERE gs.resolved_user_id IS NULL
   AND p.email IS NOT NULL
   AND lower(gs.email) = lower(p.email);

-- Project everyone: paid members get their tier from the ledger; everyone else
-- is confirmed 'starter'. No account is left blank.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT user_id FROM public.profiles LOOP
    PERFORM public.compute_membership(r.user_id);
  END LOOP;
END
$$;

-- ── Part J — Least-privilege grants ──────────────────────────────────────────
-- Internal projector + guards + drift sweep: never callable by members.
REVOKE ALL ON FUNCTION public.compute_membership(uuid)            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reproject_membership_drift()        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_profile_membership_columns()  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_gumroad_sales_project()         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_profile_resolve_pending()       FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.compute_membership(uuid)         TO service_role;
GRANT  EXECUTE ON FUNCTION public.reproject_membership_drift()     TO service_role;

-- Admin reattach: callable by authenticated (the has_role check gates it); the
-- catalog lookup: readable by authenticated (used by the projector + admin UI).
GRANT  EXECUTE ON FUNCTION public.attach_gumroad_sale(text, uuid)          TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.membership_catalog_lookup(text, text)    TO authenticated, service_role;

-- Health surface: admin-gated inside the function; callable by authenticated.
REVOKE ALL ON FUNCTION public.membership_health() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.membership_health() TO authenticated, service_role;

COMMENT ON FUNCTION public.compute_membership(uuid) IS
  'Single writer of profiles.membership_*. Derives tier/founding/billing from the gumroad_sales ledger + membership_products catalog. Idempotent.';
COMMENT ON TABLE public.membership_products IS
  'Deterministic Gumroad SKU -> {tier, founding, billing} catalog. Replaces keyword-guessing. Admin-writable, authenticated-readable.';
