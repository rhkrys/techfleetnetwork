
-- ============================================================================
-- Wave 1 enterprise refactor: backend perf + security hardening + BDD coverage
-- ============================================================================

-- #3 chunk_stale_log hardening ------------------------------------------------
DROP POLICY IF EXISTS "chunk_stale_log insert any" ON public.chunk_stale_log;
CREATE POLICY "chunk_stale_log auth insert"
  ON public.chunk_stale_log
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

REVOKE INSERT ON public.chunk_stale_log FROM anon;
REVOKE USAGE, SELECT ON SEQUENCE public.chunk_stale_log_id_seq FROM anon;

CREATE OR REPLACE FUNCTION public.chunk_stale_log_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW; -- service_role bypass; RLS already gated anon out
  END IF;
  SELECT count(*) INTO v_count
  FROM public.chunk_stale_log
  WHERE user_id = v_uid
    AND occurred_at > now() - interval '1 hour';
  IF v_count >= 100 THEN
    RAISE EXCEPTION 'rate_limit_exceeded: chunk_stale_log capped at 100/hour per user';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chunk_stale_log_rate_limit_trg ON public.chunk_stale_log;
CREATE TRIGGER chunk_stale_log_rate_limit_trg
  BEFORE INSERT ON public.chunk_stale_log
  FOR EACH ROW EXECUTE FUNCTION public.chunk_stale_log_rate_limit();

-- #5 quest-nudge N+1 → single RPC --------------------------------------------
CREATE OR REPLACE FUNCTION public.get_nudgeable_quest_users(
  p_inactivity_days int DEFAULT 7,
  p_nudge_interval_days int DEFAULT 7
)
RETURNS TABLE (
  selection_id uuid, user_id uuid, path_id uuid,
  path_title text, path_slug text,
  total_steps int, completed_count int,
  email text, first_name text, display_name text,
  notify_announcements boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH candidates AS (
    SELECT s.id AS selection_id, s.user_id, s.path_id
    FROM public.user_quest_selections s
    WHERE s.started_at IS NOT NULL
      AND s.completed_at IS NULL
      AND (s.last_nudged_at IS NULL
           OR s.last_nudged_at < now() - make_interval(days => p_nudge_interval_days))
      AND NOT EXISTS (
        SELECT 1 FROM public.journey_progress jp
        WHERE jp.user_id = s.user_id
          AND jp.updated_at > now() - make_interval(days => p_inactivity_days)
      )
  ),
  step_counts AS (
    SELECT path_id, count(*)::int AS total
    FROM public.quest_path_steps
    WHERE path_id IN (SELECT path_id FROM candidates)
    GROUP BY path_id
  ),
  user_done AS (
    SELECT user_id, count(*)::int AS done
    FROM public.journey_progress
    WHERE completed = true
      AND user_id IN (SELECT user_id FROM candidates)
    GROUP BY user_id
  )
  SELECT c.selection_id, c.user_id, c.path_id,
         p.title, p.slug,
         COALESCE(sc.total,0), COALESCE(ud.done,0),
         pr.email, pr.first_name, pr.display_name, pr.notify_announcements
  FROM candidates c
  JOIN public.quest_paths p ON p.id = c.path_id
  LEFT JOIN step_counts sc ON sc.path_id = c.path_id
  LEFT JOIN user_done   ud ON ud.user_id = c.user_id
  JOIN public.profiles pr ON pr.user_id = c.user_id
  WHERE pr.email IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.get_nudgeable_quest_users(int, int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_nudgeable_quest_users(int, int) TO service_role;

-- #6 Advisory-lock key namespacing -------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_all_stats_lock_key()
RETURNS bigint LANGUAGE sql IMMUTABLE
AS $$ SELECT hashtextextended('recompute_all_stats:v3', 0); $$;

DO $patch$
DECLARE v_src text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='recompute_all_stats';
  IF v_src IS NOT NULL AND v_src LIKE '%pg_try_advisory_xact_lock(8675309)%' THEN
    v_new := replace(v_src,
      'pg_try_advisory_xact_lock(8675309)',
      'pg_try_advisory_xact_lock(public.recompute_all_stats_lock_key())');
    EXECUTE v_new;
  END IF;
END;
$patch$;

-- #7 email_send_log freq-cap partial composite index -------------------------
CREATE INDEX IF NOT EXISTS idx_email_send_log_recipient_status_template_created
  ON public.email_send_log (recipient_email, template_name, created_at DESC)
  WHERE status = 'sent';

-- BDD scenarios (Wave 1) -----------------------------------------------------
INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin) VALUES
('Wave1 Security', 7001, 'SEC-W1-001', 'Anon JWT cannot trigger prewarm-ugc-worker',
$g$Feature: Service-role gate on prewarm-ugc-worker
  @wave1 @security
  Scenario: Anon JWT receives 401
    Given an unauthenticated client invokes prewarm-ugc-worker
    When the function evaluates Authorization
    Then [Code] the function returns 401 with body {"error":"unauthorized"}
      And [UI] no Translating… badges flicker for affected entities
      And [DB] no new rows are inserted into ugc_translations by that invocation$g$),

('Wave1 Security', 7002, 'SEC-W1-002', 'Anon JWT cannot trigger fleety-weekly-digest',
$g$Feature: Service-role gate on fleety-weekly-digest
  @wave1 @security
  Scenario: Anon JWT receives 401
    Given an unauthenticated client invokes fleety-weekly-digest
    When the function evaluates Authorization
    Then [Code] the function returns 401 with body {"error":"unauthorized"}
      And [DB] no fleety-coach-digest rows are queued in email_send_log
      And [UI] admins do not receive an out-of-schedule digest$g$),

('Wave1 Security', 7003, 'SEC-W1-003', 'chunk_stale_log anon revoke + 100/hr cap',
$g$Feature: chunk_stale_log hardening
  @wave1 @security
  Scenario: Anon insert denied
    Given a client using the anon key
    When it posts to chunk_stale_log
    Then [DB] PostgREST returns 401/permission-denied
      And [UI] the client console logs the suppression but no row is created
      And [Code] the rate-limit trigger is not consulted
  Scenario: Authenticated 100/hr cap
    Given an authenticated user with 100 rows in the past hour
    When the user attempts a 101st insert
    Then [DB] the trigger raises rate_limit_exceeded
      And [Code] the SDK error contains "rate_limit_exceeded"
      And [UI] no additional stale-chunk toast is shown$g$),

('Wave1 Security', 7004, 'SEC-W1-004', 'TranslatedContent sanitizes HTML',
$g$Feature: XSS hardening on TranslatedContent
  @wave1 @security
  Scenario: Script tags stripped before innerHTML
    Given TranslatedContent renders contentFormat="html"
    When the resolved text contains <script>alert(1)</script>
    Then [UI] no script element appears in the DOM
      And [Code] sanitizeHtml() is invoked on the text
      And [DB] no exfil telemetry is recorded$g$),

('Wave1 Perf', 7005, 'PERF-W1-005', 'quest-nudge collapses N+1 into one RPC',
$g$Feature: quest-nudge single RPC fanout
  @wave1 @perf
  Scenario: Cron uses a single RPC
    Given 100 nudgeable quest selections
    When quest-nudge runs
    Then [Code] only one rpc("get_nudgeable_quest_users") call is made
      And [DB] no per-user step/profile/path SELECT loop appears in pg_stat_statements
      And [UI] eligible users still receive one in-app notification each$g$),

('Wave1 Perf', 7006, 'PERF-W1-006', 'Advisory-lock key namespaced',
$g$Feature: Cron advisory-lock collision fix
  @wave1 @perf
  Scenario: Unrelated crons no longer share 8675309
    Given recompute_all_stats is mid-flight
    When an unrelated cron tries pg_try_advisory_xact_lock with its own key
    Then [DB] the unrelated cron acquires its lock and runs
      And [Code] recompute_all_stats_lock_key() returns hashtextextended('recompute_all_stats:v3',0)
      And [UI] network-stats widgets keep refreshing on schedule$g$),

('Wave1 Perf', 7007, 'PERF-W1-007', 'email_send_log freq-cap partial index',
$g$Feature: Email frequency-cap query speedup
  @wave1 @perf
  Scenario: Index used for per-recipient sent lookups
    Given idx_email_send_log_recipient_status_template_created exists
    When the cap check queries recent sent emails for a recipient
    Then [DB] EXPLAIN shows an Index Scan on the new partial index
      And [Code] cap-check p95 stays under 50ms
      And [UI] no user-visible latency change on send actions$g$),

('Wave1 Perf', 7008, 'PERF-W1-008', 'dom-translator self-write guard + en-restore prune',
$g$Feature: DOM translator memory + main-thread fix
  @wave1 @perf
  Scenario: Self-mutation guard ignores our own writes
    Given the translator wrote a cached translation to a Text node
    When the MutationObserver fires for that characterData change
    Then [Code] the change is recognised as isOwnWrite and skipped
      And [DB] no extra translate-strings job is queued
      And [UI] no flicker between languages
  Scenario: en switch releases tracked nodes
    Given the user switches to "en"
    When setActiveLanguage("en") runs
    Then [Code] tracked refs are pruned and originals restored
      And [UI] the page renders entirely in English
      And [DB] no further translate-strings requests are sent$g$),

('Wave1 Perf', 7009, 'PERF-W1-009', 'jspdf dynamic import',
$g$Feature: MyJourney initial-parse weight cut
  @wave1 @perf
  Scenario: jspdf absent from initial chunk
    Given the user lands on /my-journey
    When the page mounts
    Then [Code] no jspdf module is in the initial network waterfall
      And [UI] tab switches stay under 100ms TBT
  Scenario: jspdf loads only on Get Certificate click
    Given the user clicks Get Certificate
    When generateCertificatePdf is invoked
    Then [Code] dynamic import("jspdf") resolves
      And [UI] the PDF downloads with the same filename
      And [DB] no new logging is introduced$g$),

('Wave1 Perf', 7010, 'PERF-W1-010', 'Static client + reporter imports',
$g$Feature: Vite static/dynamic collision fix
  @wave1 @perf
  Scenario: Clean production build with no warning
    Given a fresh vite build
    When bundling completes
    Then [Code] no warning is emitted for supabase/client or error-reporter.service
      And [UI] runtime behavior is unchanged
      And [DB] only one supabase client is constructed at runtime$g$),

('Wave1 Perf', 7011, 'PERF-W1-011', 'Quest components Map lookups',
$g$Feature: Quest list rendering speedup
  @wave1 @perf
  Scenario: Map-based pathBySlug / pathById
    Given 8 selections and 30 quest_paths
    When QuestRoadmap renders
    Then [Code] pathBySlug.get is used in place of paths.find
      And [UI] the roadmap paints under 16ms in React Profiler
      And [DB] no additional queries are issued$g$),

('Wave1 Cost', 7012, 'COST-W1-012', 'Pin techfleet-chat to gemini-2.5-flash',
$g$Feature: Fleety model pin
  @wave1 @cost
  Scenario: Stable model used for uncached turns
    Given a Fleety turn that misses canned + L3 cache
    When the function POSTs to the AI gateway
    Then [Code] the request body model equals "google/gemini-2.5-flash"
      And [DB] fleety_cost_log row carries _model="google/gemini-2.5-flash"
      And [UI] response quality stays within 10% of baseline on regression prompts$g$),

('Wave1 Cost', 7013, 'COST-W1-013', 'Pin prewarm-ugc-worker to gemini-2.5-flash-lite',
$g$Feature: UGC translation cost reduction
  @wave1 @cost
  Scenario: Translation requests use flash-lite
    Given a batch of pending ugc_translation_jobs
    When prewarm-ugc-worker drains the batch
    Then [Code] each AI request body has model="google/gemini-2.5-flash-lite"
      And [DB] per-translation cost telemetry drops ≥ 50% vs prior baseline
      And [UI] translated content still passes the 4-gate QA$g$),

('Wave1 Cost', 7014, 'COST-W1-014', 'Canned-answer L2 short-circuit',
$g$Feature: Fleety canned L2 short-circuit
  @wave1 @cost
  Scenario: Canned hit ≥ 0.45 bypasses LLM
    Given fleety_match_canned_answers returns similarity 0.7
    When techfleet-chat handles the turn
    Then [Code] buildCacheSSEStream streams answer_md without calling the AI gateway
      And [DB] fleety_record_cost is logged with _model="canned" and _est_usd ≤ 0.0001
      And [UI] the user sees the curated answer streamed token-by-token$g$),

('Wave1 UX', 7015, 'UX-W1-015', 'Gate FleetyChatWidget conversation load',
$g$Feature: Defer Fleety history fetch
  @wave1 @ux
  Scenario: Conversation list waits for first open
    Given the user navigates to a page with FleetyChatWidget mounted
    When the widget has not been opened
    Then [Code] no SELECT chat_conversations request is fired
      And [UI] no network entry for chat_conversations appears
      And [DB] PostgREST logs show no read for the unopened session
  Scenario: First open triggers a single fetch
    Given the user clicks the Fleety bubble
    When the Sheet opens for the first time
    Then [Code] loadConversations runs exactly once
      And [UI] the recent-chats list renders within 200ms$g$),

('Wave1 UX', 7016, 'UX-W1-016', 'MyJourney tabs use Suspense + lazy',
$g$Feature: MyJourney tab streaming
  @wave1 @ux
  Scenario: Tab switches do not block render
    Given the user is on /my-journey
    When they switch between Quests, My Projects, My Classes, Certifications, Project Certifications
    Then [UI] a skeleton fallback paints within 16ms of click
      And [Code] each tab body is loaded via React.lazy + Suspense
      And [DB] no extra queries are issued for tabs the user did not open$g$);
