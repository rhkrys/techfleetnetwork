-- 1) chunk_stale_log
CREATE TABLE IF NOT EXISTS public.chunk_stale_log (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  build_id_client TEXT, build_id_server TEXT, url TEXT, user_agent TEXT,
  recovered BOOLEAN NOT NULL DEFAULT true
);
GRANT SELECT ON public.chunk_stale_log TO authenticated;
GRANT INSERT ON public.chunk_stale_log TO anon, authenticated;
GRANT ALL ON public.chunk_stale_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.chunk_stale_log_id_seq TO anon, authenticated;
ALTER TABLE public.chunk_stale_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chunk_stale_log insert any" ON public.chunk_stale_log;
CREATE POLICY "chunk_stale_log insert any" ON public.chunk_stale_log FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "chunk_stale_log admin select" ON public.chunk_stale_log;
CREATE POLICY "chunk_stale_log admin select" ON public.chunk_stale_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS idx_chunk_stale_log_occurred_at ON public.chunk_stale_log(occurred_at DESC);

-- 2) function_grant_audit
CREATE TABLE IF NOT EXISTS public.function_grant_audit (
  schema_name TEXT NOT NULL, function_name TEXT NOT NULL, function_signature TEXT NOT NULL,
  granted_to_anon BOOLEAN NOT NULL DEFAULT false,
  granted_to_authenticated BOOLEAN NOT NULL DEFAULT false,
  granted_to_service_role BOOLEAN NOT NULL DEFAULT false,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (schema_name, function_signature)
);
GRANT SELECT ON public.function_grant_audit TO authenticated;
GRANT ALL ON public.function_grant_audit TO service_role;
ALTER TABLE public.function_grant_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "function_grant_audit admin read" ON public.function_grant_audit;
CREATE POLICY "function_grant_audit admin read" ON public.function_grant_audit FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.refresh_function_grant_audit()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER := 0;
BEGIN
  TRUNCATE public.function_grant_audit;
  INSERT INTO public.function_grant_audit (schema_name, function_name, function_signature, granted_to_anon, granted_to_authenticated, granted_to_service_role)
  SELECT n.nspname, p.proname, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         has_function_privilege('anon', p.oid, 'EXECUTE'),
         has_function_privilege('authenticated', p.oid, 'EXECUTE'),
         has_function_privilege('service_role', p.oid, 'EXECUTE')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;
REVOKE ALL ON FUNCTION public.refresh_function_grant_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_function_grant_audit() TO service_role;
SELECT public.refresh_function_grant_audit();

-- 3) known_issue_catalog substring TTL
CREATE OR REPLACE FUNCTION public.enforce_known_issue_substring_ttl()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.match_kind = 'substring' AND (NEW.expires_at IS NULL OR NEW.expires_at > now() + interval '30 days') THEN
    RAISE EXCEPTION 'substring rules must set expires_at within 30 days (got %)', NEW.expires_at
      USING HINT = 'Prefer match_kind=event_type for permanent suppressions';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_known_issue_substring_ttl ON public.known_issue_catalog;
CREATE TRIGGER trg_known_issue_substring_ttl BEFORE INSERT OR UPDATE ON public.known_issue_catalog FOR EACH ROW EXECUTE FUNCTION public.enforce_known_issue_substring_ttl();
UPDATE public.known_issue_catalog SET expires_at = now() + interval '30 days'
 WHERE match_kind = 'substring' AND (expires_at IS NULL OR expires_at > now() + interval '30 days');

-- 4) interview_invites CASCADE
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='interview_invites')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='interview_invites' AND column_name='application_id')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='project_applications')
  THEN
    ALTER TABLE public.interview_invites DROP CONSTRAINT IF EXISTS interview_invites_application_id_fkey;
    ALTER TABLE public.interview_invites ADD CONSTRAINT interview_invites_application_id_fkey
      FOREIGN KEY (application_id) REFERENCES public.project_applications(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 5) Transactional email requires unsubscribe_token
CREATE OR REPLACE FUNCTION public.enforce_transactional_unsubscribe_token()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_has_token_col BOOLEAN; v_has_category_col BOOLEAN; v_category TEXT; v_token TEXT;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='email_send_log' AND column_name='unsubscribe_token') INTO v_has_token_col;
  SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='email_send_log' AND column_name='template_category') INTO v_has_category_col;
  IF NOT v_has_token_col OR NOT v_has_category_col THEN RETURN NEW; END IF;
  EXECUTE 'SELECT ($1).template_category::text, ($1).unsubscribe_token::text' INTO v_category, v_token USING NEW;
  IF v_category = 'transactional' AND v_token IS NULL THEN
    RAISE EXCEPTION 'transactional emails require unsubscribe_token (template_category=%, token=null)', v_category
      USING HINT = 'Pre-generate via create_unsubscribe_token() before enqueue.';
  END IF;
  RETURN NEW;
END; $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='email_send_log') THEN
    DROP TRIGGER IF EXISTS trg_transactional_requires_unsubscribe_token ON public.email_send_log;
    CREATE TRIGGER trg_transactional_requires_unsubscribe_token BEFORE INSERT ON public.email_send_log FOR EACH ROW EXECUTE FUNCTION public.enforce_transactional_unsubscribe_token();
  END IF;
END $$;

-- 6) BDD scenarios (feature_area_number 6001..6015 reserved for Triage Permanent)
INSERT INTO public.bdd_scenarios (scenario_id, feature_area, feature_area_number, title, gherkin) VALUES
('TRP-001','Triage Permanent Refactor',6001,'Stale chunk recovers silently via build-id soft reload',$g$Feature: Stale chunk soft reload
  Scenario: Build-id mismatch triggers soft reload before chunk-load error fires
    Given the client has loaded build-id "abc" and the server now serves "xyz"
    When the user navigates to a new route
    Then [UI] the new route renders successfully with no error toast
      And [DB] a row exists in chunk_stale_log with recovered=true
      And [Code] error-reporter.service.reportError is not called for chunk loading$g$),
('TRP-002','Triage Permanent Refactor',6002,'Browser-extension frame errors never enqueue to triage',$g$Feature: Extension noise rejection
  Scenario: Synthetic error with chrome-extension stack frame is dropped at reporter
    Given a window error event with stack frame "chrome-extension://abc/inpage.js:1:1"
    When the global handler processes the event
    Then [UI] no toast is shown
      And [DB] no row is inserted into agent_fix_queue
      And [Code] classify(error).report === false$g$),
('TRP-003','Triage Permanent Refactor',6003,'Offline fetch failures never report',$g$Feature: Offline tolerance
  Scenario: TypeError fetch failure while navigator.onLine === false
    Given navigator.onLine returns false
    When a React Query refetch throws TypeError "Failed to fetch"
    Then [UI] the query shows its loading or last-success state, no error toast
      And [DB] no row is inserted into audit_log for client_error
      And [Code] reportError is not invoked$g$),
('TRP-004','Triage Permanent Refactor',6004,'PGRST116 from maybeSingle returns null instead of throwing',$g$Feature: Single-row safety
  Scenario: maybeSingle on empty result returns null
    Given a Supabase select with .maybeSingle() that matches zero rows
    When the query resolves
    Then [UI] caller renders the "no record yet" empty state
      And [DB] no PGRST116 error is generated
      And [Code] data === null and error === null$g$),
('TRP-005','Triage Permanent Refactor',6005,'Transactional email enqueue without unsubscribe_token is rejected at DB layer',$g$Feature: Transactional email integrity
  Scenario: Insert into email_send_log without unsubscribe_token
    Given an insert with template_category="transactional" and unsubscribe_token=null
    When the row is inserted
    Then [DB] the trigger enforce_transactional_unsubscribe_token raises EXCEPTION
      And [Code] the enqueue caller receives a 4xx response and does not retry blindly
      And [UI] the admin sees the failure in System Health > Email tab, not Triage$g$),
('TRP-006','Triage Permanent Refactor',6006,'Orphan interview invite cascades on application delete',$g$Feature: Orphan email prevention
  Scenario: Application deletion cascades to interview invites
    Given an interview_invites row referencing project_applications.id "X"
    When project_applications row "X" is deleted
    Then [DB] the interview_invites row is also removed via ON DELETE CASCADE
      And [Code] process-email-queue never observes the orphan
      And [UI] no email_interview_invite_pipeline_unhealthy event is emitted$g$),
('TRP-007','Triage Permanent Refactor',6007,'use-autosave serializes Supabase errors via toError',$g$Feature: Error serialization
  Scenario: Hook receives a non-Error Supabase payload
    Given onSave throws { code: "PGRST...", message: "row failed" }
    When use-autosave catches the throw
    Then [Code] toError(payload) returns an Error with message === "row failed"
      And [DB] audit_log row carries message "row failed", never "[object Object]"
      And [UI] the autosave indicator shows the human message$g$),
('TRP-008','Triage Permanent Refactor',6008,'ApplicationSaveError retries network failures once and succeeds',$g$Feature: Resilient application save
  Scenario: Edge invoke fails once then succeeds
    Given invokeEdge("save-general-application") throws FunctionsFetchError on attempt 1
    When the wrapper retries after 500ms and the second call returns 200
    Then [UI] the user sees the success state, no toast
      And [DB] exactly one application row is committed (idempotency key dedupes)
      And [Code] no ApplicationSaveError is thrown to the caller$g$),
('TRP-009','Triage Permanent Refactor',6009,'agent_fix_queue rejects self-healing event_types via DB trigger',$g$Feature: Triage queue hygiene
  Scenario: Insert self-healing event_type into agent_fix_queue
    Given block_non_actionable_fix_queue_inserts trigger is active
    When an insert with non-actionable event_type is attempted
    Then [DB] the row is silently skipped
      And [Code] reporter does not crash
      And [UI] admins do not see noise in Triage tab$g$),
('TRP-010','Triage Permanent Refactor',6010,'known_issue_catalog substring rules require expires_at within 30 days',$g$Feature: Suppression hygiene
  Scenario: Insert substring rule without expires_at
    Given trg_known_issue_substring_ttl is active
    When an insert with match_kind="substring" and expires_at IS NULL is attempted
    Then [DB] the trigger raises EXCEPTION with HINT about event_type rules
      And [Code] the migration author is forced to set a 30-day expiry
      And [UI] admins in System Health see the rule auto-expire and re-evaluate$g$),
('TRP-011','Triage Permanent Refactor',6011,'function_grant_audit detects missing GRANT EXECUTE',$g$Feature: RPC accessibility audit
  Scenario: Newly created public function without grants
    Given a function public.demo_fn() is created without GRANT EXECUTE
    When refresh_function_grant_audit() runs
    Then [DB] a row exists in function_grant_audit with all granted_* = false
      And [Code] daily cron flags missing_grants > 0
      And [UI] System Health Triage tab surfaces the gap to admins$g$),
('TRP-012','Triage Permanent Refactor',6012,'Reporter strips PII before writing to audit_log',$g$Feature: PII safety
  Scenario: Error message contains an email address
    Given reportError is called with "User test@example.com failed"
    When the report is normalized
    Then [DB] audit_log message contains "[redacted-email]" not "test@example.com"
      And [Code] formatThrowable() strips the email per PII redaction rules
      And [UI] admins see redacted message in Activity Log$g$),
('TRP-013','Triage Permanent Refactor',6013,'Build-id versioning surfaces in chunk_stale_log',$g$Feature: Build versioning trail
  Scenario: Soft reload occurs because of build-id mismatch
    Given chunk_stale_log insert with build_id_client="abc" and build_id_server="xyz"
    When admin opens System Health > Performance
    Then [DB] chunk_stale_log row carries both build ids
      And [Code] no row in agent_fix_queue or audit_log for that event
      And [UI] admins see chunk recovery metric, separate from real errors$g$),
('TRP-014','Triage Permanent Refactor',6014,'Typed AppError hierarchy supersedes raw Error throws',$g$Feature: Typed error hierarchy
  Scenario: Service throws NotFoundError, caller renders empty state
    Given a service uses safeSelect().maybeSingle() and the row does not exist
    When the caller awaits the call
    Then [Code] caller receives null without an exception
      And [UI] the page renders "no record yet" empty state with retry CTA
      And [DB] no audit_log row is written for the absence$g$),
('TRP-015','Triage Permanent Refactor',6015,'ESLint rule blocks raw .single() without explicit annotation',$g$Feature: Code-level prevention
  Scenario: PR introduces a bare .single() call
    Given the no-supabase-single lint rule is enabled
    When CI runs ESLint on the diff
    Then [Code] the lint fails with a message pointing to .maybeSingle()
      And [UI] the developer cannot merge until the annotation or replacement is added
      And [DB] no new PGRST116 fingerprints can land in agent_fix_queue$g$)
ON CONFLICT (scenario_id) DO UPDATE
  SET title = EXCLUDED.title, gherkin = EXCLUDED.gherkin,
      feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
      updated_at = now();