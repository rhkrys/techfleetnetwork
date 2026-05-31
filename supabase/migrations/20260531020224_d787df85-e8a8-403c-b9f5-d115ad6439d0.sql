INSERT INTO public.bdd_scenarios
  (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file, notes)
VALUES
('Regression CI Pipeline', 43001, 'W1-RG-CI-001', 'Playwright shards never hit the job timeout',
$$Feature: Regression Playwright shards complete within job ceiling
  Scenario: A 6-way sharded run finishes inside 22 minutes
    Given the regression workflow runs on a pull request
    When all 6 chromium shards execute in parallel
    Then [UI] the GitHub Actions UI shows each shard completing without "The operation was canceled"
    And [Code] playwright.config.ts globalTimeout=20min keeps any single shard under the 22min job cap
    And [DB] no agent_fix_queue row is created with fingerprint "playwright-shard-cancelled"$$,
 'not_built', 'manual', '', 'Wave 0 hardening verification.'),
('Regression CI Pipeline', 43001, 'W1-RG-CI-002', 'Blob reports merge into a single HTML report',
$$Feature: Cross-shard HTML report
  Scenario: merge-reports job combines all 6 blob artifacts
    Given all 6 shards uploaded a blob-report artifact
    When the merge-reports job runs
    Then [UI] a single "playwright-merged-html-report" artifact is attached
    And [Code] "npx playwright merge-reports --reporter html" exits 0
    And [DB] n/a$$,
 'not_built', 'manual', '', ''),
('Regression CI Pipeline', 43001, 'W1-RG-CI-003', 'Retries capped at 1 in CI',
$$Feature: Bounded retry budget
  Scenario: A failing test only retries once
    Given playwright.config.ts retries=1 in CI
    When a test fails on first attempt
    Then [Code] Playwright runs at most one retry
    And [UI] the HTML report shows at most 2 attempts
    And [DB] n/a$$,
 'not_built', 'manual', '', ''),
('Regression CI Pipeline', 43001, 'W1-RG-CI-004', 'Per-test timeout is 45 seconds',
$$Feature: Per-test ceiling
  Scenario: A runaway selector wait is killed at 45s
    Given timeout=45000 in playwright.config.ts
    When a test waits on a never-resolving selector
    Then [Code] Playwright kills the test with "Test timeout of 45000ms exceeded"
    And [UI] the HTML report marks it timed-out, not cancelled
    And [DB] n/a$$,
 'not_built', 'manual', '', ''),
('Regression CI Pipeline', 43001, 'W1-RG-CI-005', 'Auth specs use a single retry max',
$$Feature: Bounded auth flake
  Scenario: A Registration spec fails twice then surfaces error
    Given e2e/auth.e2e.ts describe blocks set retries=1
    When Cloudflare Turnstile never bootstraps
    Then [Code] each test runs at most 2 times total
    And [UI] the shard finishes within 4 minutes even if every auth test fails
    And [DB] n/a$$,
 'not_built', 'e2e', 'e2e/auth.e2e.ts', ''),

('Application Analysis', 4101, 'W1-AA-AUT-001', 'Non-admin blocked from /admin/application-analysis',
$$Feature: Admin-only page
  Scenario: Member visits /admin/application-analysis
    Given a signed-in member without admin role
    When they navigate to /admin/application-analysis
    Then [UI] they see the "Not authorized" empty state
    And [Code] no fetch to admin_role_readiness RPC is issued
    And [DB] no row is read from project_role_readiness_v$$,
 'not_built', 'e2e', 'e2e/admin/application-analysis.e2e.ts', ''),
('Application Analysis', 4101, 'W1-AA-AUT-002', 'Anonymous redirected to /login',
$$Feature: Auth gate
  Scenario: Anonymous visits /admin/application-analysis
    Given no session
    When they navigate to /admin/application-analysis
    Then [UI] they land on /login with redirect preserved
    And [Code] no Supabase RPC is invoked
    And [DB] no audit_log row is written$$,
 'not_built', 'e2e', 'e2e/admin/application-analysis.e2e.ts', ''),
('Application Analysis', 4101, 'W1-AA-DAT-001', 'Readiness metrics dashboard renders for admin',
$$Feature: Admin sees metrics
  Scenario: Admin opens application analysis
    Given an admin session
    When they open /admin/application-analysis for an active project
    Then [UI] each role card shows a 0-100 readiness score, a stack-rank list, and View applicants CTA
    And [Code] admin_role_readiness RPC returns within 3s
    And [DB] RPC reads only from project_role_readiness_v scoped to that project_id$$,
 'not_built', 'e2e', 'e2e/admin/application-analysis.e2e.ts', ''),

('Project Blast', 4102, 'W1-PB-AUT-001', 'Member cannot open Project Blast composer',
$$Feature: Coordinator-only Project Blast
  Scenario: Member visits Recruiting Center
    Given a member who is not a project coordinator
    When they navigate to /admin/recruiting-center/<project>
    Then [UI] the Project Blast button is hidden
    And [Code] can_project_blast RPC returns false
    And [DB] no project_blasts row exists with them as author$$,
 'not_built', 'e2e', 'e2e/admin/project-blast-author.e2e.ts', ''),
('Project Blast', 4102, 'W1-PB-SND-001', 'Coordinator sends a blast and rows persist',
$$Feature: Send Project Blast
  Scenario: Coordinator composes and sends a blast
    Given a coordinator on a project with 5 applicants
    When they fill subject + body and click "Send blast"
    Then [UI] a 30s success toast confirms "Blast queued to 5 recipients"
    And [Code] supabase.functions.invoke('project-blast') returns 200
    And [DB] one project_blasts row + 5 project_blast_recipients + 5 transactional_emails rows exist$$,
 'not_built', 'e2e', 'e2e/admin/project-blast-author.e2e.ts', ''),
('Project Blast', 4102, 'W1-PB-REC-001', 'Recipient sees blast in notifications and inbox',
$$Feature: Member receives Project Blast
  Scenario: Member loads dashboard after blast
    Given a member applicant on a project that just received a blast
    When they open /dashboard
    Then [UI] the notification badge increments and inbox shows the subject line
    And [Code] notifications query returns the new row
    And [DB] notifications.body matches project_blasts.body for that blast_id$$,
 'not_built', 'e2e', 'e2e/applications/project-blast-recipient.e2e.ts', ''),

('Triage Permanent Refactor', 4103, 'W1-TR-001', 'Stale chunk errors never reach agent_fix_queue',
$$Feature: Triage noise suppression
  Scenario: Browser hits a stale chunk after deploy
    Given a member with an outdated bundle
    When window dispatches "ChunkLoadError"
    Then [Code] the reporter classifies severity=info and drops the event
    And [DB] no row is inserted into agent_fix_queue with that fingerprint
    And [UI] System Health > Triage shows no new entry$$,
 'not_built', 'unit', 'src/test/triage/stale-chunk-suppression.test.ts', ''),
('Triage Permanent Refactor', 4103, 'W1-TR-002', 'Admin marks a triage entry resolved',
$$Feature: Admin closes a triage entry
  Scenario: Admin resolves an agent_fix_queue row
    Given an admin viewing System Health > Triage
    When they click "Mark resolved" on a row
    Then [UI] the row disappears and badge decrements
    And [Code] resolve_agent_fix_queue RPC returns success
    And [DB] agent_fix_queue.resolved_at IS NOT NULL$$,
 'not_built', 'e2e', 'e2e/admin/triage-queue.e2e.ts', ''),
('Triage Permanent Refactor', 4103, 'W1-TR-003', 'Member cannot read agent_fix_queue',
$$Feature: agent_fix_queue is admin-only
  Scenario: Member queries agent_fix_queue
    Given a signed-in member
    When they call supabase.from('agent_fix_queue').select('*')
    Then [Code] response is empty under RLS
    And [DB] no rows returned
    And [UI] n/a$$,
 'not_built', 'unit', 'src/test/db/agent-fix-queue.rls.test.ts', ''),

('Email Deliverability Hardening', 4104, 'W1-EDH-001', 'Per-lane cooldown isolates failing queue',
$$Feature: 429 cooldown is per-lane
  Scenario: project-blast lane hits provider 429
    Given email provider returns 429 on a project-blast send
    When the email worker processes the next tick
    Then [Code] email_send_state.cooldown_until is set only for queue=project_blast
    And [DB] queue=auth continues to drain normally
    And [UI] System Health > Email shows project_blast in cooldown state$$,
 'not_built', 'unit', 'src/test/email/per-lane-cooldown.test.ts', ''),
('Email Deliverability Hardening', 4104, 'W1-EDH-002', 'Exponential backoff caps at 900s',
$$Feature: Bounded backoff
  Scenario: 7 consecutive 429s on the same lane
    Given the lane has failed 6 times with growing backoff
    When the 7th failure arrives
    Then [Code] cooldown_until - now() <= 900s
    And [DB] email_send_state.consecutive_failures = 7
    And [UI] "Maximum backoff reached" badge visible in Email tab$$,
 'not_built', 'unit', 'src/test/email/backoff-cap.test.ts', ''),

('Observer Role Opt-In', 4105, 'W1-OBS-001', 'Member completes obs-8 and gets Observer role',
$$Feature: Observer role grant
  Scenario: Member finishes Observer onboarding
    Given a member with a linked Discord account
    When they finish lesson "obs-8"
    Then [UI] a celebratory success card with "Welcome, Observer" appears
    And [Code] grant-observer-role edge fn returns 200
    And [DB] user_roles row (role='observer') exists for that user$$,
 'not_built', 'e2e', 'e2e/community/observer-role-optin.e2e.ts', ''),
('Observer Role Opt-In', 4105, 'W1-OBS-002', 'Observer without Discord link sees connect CTA',
$$Feature: Discord prerequisite
  Scenario: Member finishes obs-8 without Discord link
    Given a member with no discord_identities row
    When they finish lesson "obs-8"
    Then [UI] success card shows "Link your Discord to claim Observer role"
    And [Code] grant-observer-role returns 412
    And [DB] no user_roles row inserted$$,
 'not_built', 'e2e', 'e2e/community/observer-role-optin.e2e.ts', ''),

('Email Queue Resilience', 4106, 'W1-EQR-001', 'Worker recovers via CircuitBreaker probe',
$$Feature: Self-heal logging
  Scenario: Probe succeeds after open state
    Given provider has been down 5 minutes
    When the half-open probe succeeds
    Then [Code] external_api_recovered event emitted
    And [DB] one agent_fix_queue row with kind='self_healed'
    And [UI] next daily digest shows self-recovered count$$,
 'not_built', 'unit', 'src/test/email/self-heal-logging.test.ts', ''),

('Notifications', 4107, 'W1-NOT-001', 'Member sees in-app notification within 5s of insert',
$$Feature: Realtime in-app notifications
  Scenario: Insert a notification row for a signed-in member
    Given a member on /dashboard
    When a notifications row is inserted for their user_id
    Then [UI] the bell badge increments within 5 seconds
    And [Code] realtime channel "notifications:<user_id>" receives the payload
    And [DB] notifications.read_at IS NULL$$,
 'not_built', 'e2e', 'e2e/notifications/push-and-inapp.e2e.ts', ''),
('Notifications', 4107, 'W1-NOT-002', 'Mark all read flips every notification',
$$Feature: Bulk mark all read
  Scenario: Member clicks "Mark all read" with 12 unread
    Given inbox shows 12 unread
    When they click "Mark all read"
    Then [UI] bell badge drops to 0 and rows fade
    And [Code] mark_all_notifications_read RPC returns 12
    And [DB] every notifications row for that user has read_at = now()$$,
 'not_built', 'e2e', 'e2e/notifications/push-and-inapp.e2e.ts', ''),

('Community Contributor Agreement', 4108, 'W1-CCA-001', 'CCA blocks first project apply',
$$Feature: CCA gate
  Scenario: Member applies without signing CCA
    Given a member with no cca_signatures row
    When they click Apply on a project opening
    Then [UI] the CCA modal opens and apply form is blocked
    And [Code] submission is rejected with 412
    And [DB] no project_applications row created$$,
 'not_built', 'e2e', 'e2e/profile/cca-signing.e2e.ts', ''),
('Community Contributor Agreement', 4108, 'W1-CCA-002', 'Signed CCA persists in profile',
$$Feature: CCA signature persistence
  Scenario: Member signs CCA
    Given the CCA modal is open
    When they type full name and click "I agree"
    Then [UI] modal closes; profile > legal shows "CCA signed on <date>"
    And [Code] cca_signatures insert returns 201
    And [DB] cca_signatures row exists with signed_at and version$$,
 'not_built', 'e2e', 'e2e/profile/cca-signing.e2e.ts', ''),

('i18n-ugc', 4109, 'W1-I18N-UGC-015', 'UGC translation broadcast is scoped per entity',
$$Feature: Per-entity Realtime topic
  Scenario: Two members view two different projects in es locale
    Given member A on /projects/PROJ-1 and member B on /projects/PROJ-2
    When a new ugc_translations row is inserted for PROJ-1 with status='qa_passed'
    Then [UI] member A sees translated copy update within 5s
    And [UI] member B sees no change
    And [DB] only realtime topic "ugc:project_openings:PROJ-1" receives broadcast$$,
 'not_built', 'e2e', 'e2e/i18n/ugc-translation.e2e.ts', ''),
('i18n-ugc', 4109, 'W1-I18N-UGC-016', 'Anon cannot read postgres_changes on ugc_translations',
$$Feature: ugc_translations not in supabase_realtime publication
  Scenario: Anonymous postgres_changes subscriber
    Given an anonymous client
    When it subscribes to postgres_changes for table=ugc_translations
    Then [Code] no INSERT/UPDATE events received even after writes
    And [DB] supabase_realtime publication does NOT include public.ugc_translations
    And [UI] n/a$$,
 'not_built', 'unit', 'src/test/realtime/ugc-translations-publication.test.ts', ''),

('Teacher Role & Classes', 4110, 'W1-TCH-001', 'Teacher submits a class for approval',
$$Feature: Teacher class submission
  Scenario: Teacher creates and submits a class
    Given a signed-in teacher with no draft classes
    When they fill the form and click "Submit for review"
    Then [UI] class card shows status="Pending review"
    And [Code] submit_class_for_review RPC returns success
    And [DB] classes.status='pending_review'; per-admin notifications inserted$$,
 'not_built', 'e2e', 'e2e/classes/teacher-class-lifecycle.e2e.ts', ''),
('Teacher Role & Classes', 4110, 'W1-TCH-002', 'Admin approves a pending class',
$$Feature: Class approval
  Scenario: Admin approves
    Given an admin on /admin/classes with a pending class
    When they click Approve
    Then [UI] the class moves from Pending to Approved
    And [Code] approve_class RPC returns success
    And [DB] classes.status='approved' and class_approvals row exists$$,
 'not_built', 'e2e', 'e2e/admin/class-approval.e2e.ts', ''),
('Teacher Role & Classes', 4110, 'W1-TCH-003', 'Non-teacher cannot insert classes',
$$Feature: Teacher-only insert
  Scenario: Member without teacher role inserts
    Given a member without teacher role
    When they call supabase.from('classes').insert(...)
    Then [Code] response is 403
    And [DB] no row inserted (RLS denies)
    And [UI] "New class" button hidden$$,
 'not_built', 'unit', 'src/test/db/classes.rls.test.ts', ''),

('Form Drafts', 4111, 'W1-FD-001', 'Application form autosaves every 30s',
$$Feature: Application autosave
  Scenario: Member types into the motivation field
    Given a member with the application form open
    When they type and wait 30s
    Then [UI] "Saved <time>" status indicator updates
    And [Code] application_drafts.upsert called exactly once
    And [DB] application_drafts.payload->>'motivation' equals the typed value$$,
 'not_built', 'e2e', 'e2e/forms/drafts-and-autosave.e2e.ts', ''),
('Form Drafts', 4111, 'W1-FD-002', 'Returning restores the draft',
$$Feature: Draft restoration
  Scenario: Member returns to an in-progress application
    Given an application_drafts row exists for member + project
    When they navigate to /apply/<project>
    Then [UI] all fields pre-populated; banner "Draft restored from <time>"
    And [Code] application_drafts select returns within 1s
    And [DB] no new draft row inserted$$,
 'not_built', 'e2e', 'e2e/forms/drafts-and-autosave.e2e.ts', ''),

('Privacy & Cookies Compliance', 4112, 'W1-PCC-001', 'GA4 and Clarity do not load before consent',
$$Feature: Consent-first analytics
  Scenario: First-time visitor on home
    Given no cookie_consents row
    When the home page loads
    Then [UI] CookieConsentBanner visible
    And [Code] window.gtag and window.clarity are undefined
    And [DB] no cookie_consents row exists yet$$,
 'not_built', 'e2e', 'e2e/privacy/no-tracking-without-consent.e2e.ts',
 'Extend existing spec.'),
('Privacy & Cookies Compliance', 4112, 'W1-PCC-002', 'DSAR submission creates a tracked request',
$$Feature: DSAR intake
  Scenario: Member submits DSAR
    Given a member on /privacy/dsar
    When they pick "Export my data" and submit
    Then [UI] confirmation card "Request received — we'll respond within 30 days"
    And [Code] dsar-submit edge fn returns 201
    And [DB] dsar_requests row status='received', due_at=now()+30d$$,
 'not_built', 'e2e', 'e2e/privacy/cookies-and-dsar.e2e.ts', ''),
('Privacy & Cookies Compliance', 4112, 'W1-PCC-003', 'GPC header forces deny',
$$Feature: GPC honored
  Scenario: Visitor sends Sec-GPC: 1
    Given a request with Sec-GPC: 1
    When the home page loads
    Then [Code] consent defaults to deny across all categories
    And [DB] cookie_consents.source='gpc'
    And [UI] banner shows "Privacy signal honored — analytics disabled"$$,
 'not_built', 'unit', 'src/test/privacy/gpc.test.ts', ''),

('Membership Tiers', 4113, 'W1-MT-001', 'Free member sees only free-tier features',
$$Feature: Tier gating
  Scenario: Free member visits a paid-tier page
    Given a member with membership_tier='free'
    When they navigate to a paid-only feature
    Then [UI] upgrade prompt replaces feature content
    And [Code] tier-gate hook returns access=false
    And [DB] no audit_log row written$$,
 'not_built', 'e2e', 'e2e/membership/tiers.e2e.ts', ''),

('Step Progress Bar', 4114, 'W1-SPB-001', 'StepProgressBar reflects Started/Active/Completed',
$$Feature: Progress visualization
  Scenario: Member completes 3 of 5 lessons
    Given a path with 5 lessons and 3 completed
    When viewing the path detail
    Then [UI] steps 1-3 Completed, 4 Active, 5 Started
    And [Code] StepProgressBar receives correct state props
    And [DB] lesson_progress rows have completed_at for steps 1-3$$,
 'not_built', 'unit', 'src/test/ui/StepProgressBar.test.tsx', ''),

('events-week-view', 4115, 'W1-EWV-001', 'Week view never shows events older than 1 day',
$$Feature: No stale events guard
  Scenario: Calendar after midnight
    Given community_events has rows with end_time < now() - 1 day
    When the refresh worker fetches events
    Then [Code] get-community-events filters out rows below HARD_FLOOR_MS
    And [DB] returned set excludes stale rows
    And [UI] WeekCalendar shows no stale entries; "Previous week" disabled at HARD_FLOOR$$,
 'not_built', 'e2e', 'e2e/events/week-view.e2e.ts', ''),

('Recruiting Center', 4116, 'W1-RC-001', 'Admin assigns a coordinator to a project',
$$Feature: Coordinator assignment
  Scenario: Admin assigns coordinator
    Given an admin on /admin/recruiting-center
    When they pick a coordinator and save
    Then [UI] coordinator badge updates on project card
    And [Code] project_coordinators insert returns 201
    And [DB] project_coordinators row exists; audit_log appended$$,
 'not_built', 'e2e', 'e2e/admin/recruiting-center.e2e.ts', ''),

('Push Notifications', 4117, 'W1-PN-001', 'Member receives a web push within 60s',
$$Feature: Web push delivery
  Scenario: Push subscription exists and event fires
    Given a member with a push_subscriptions row
    When a triage critical-push event triggers
    Then [Code] notify-critical-fix returns 200 deliveries=1
    And [DB] push_deliveries row status='delivered'
    And [UI] OS notification surface displays the message$$,
 'not_built', 'manual', '', 'Browser cannot reliably assert OS push UI.'),

('Class Approval Workflow', 4118, 'W1-CAW-001', 'Admin denies a class with a reason',
$$Feature: Class denial
  Scenario: Admin denies
    Given an admin on /admin/classes/pending
    When they click Deny, type a reason, confirm
    Then [UI] class moves to Denied tab; reason visible
    And [Code] deny_class RPC returns success
    And [DB] classes.status='denied'; class_approvals row carries reason; teacher notified$$,
 'not_built', 'e2e', 'e2e/admin/class-approval.e2e.ts', ''),

('Fleety Practical Mode', 4119, 'W1-FPM-001', 'Fleety practical mode respects token cap',
$$Feature: L6 token caps
  Scenario: Member asks a high-complexity question
    Given Fleety in practical mode
    When member sends a long prompt
    Then [Code] L1..L6 pipeline runs; final call respects tier C cap
    And [DB] fleety_turns row tokens_used <= tier_C_cap
    And [UI] response renders streaming markdown within 8s$$,
 'not_built', 'unit', 'src/test/chatbot/fleety-practical-cap.test.ts', ''),

('Form Autosave', 4120, 'W1-FAS-ADM-001', 'Admin announcement draft autosaves',
$$Feature: Announcement WYSIWYG autosave
  Scenario: Admin types announcement draft
    Given an admin in the announcement editor
    When they type and pause 30s
    Then [UI] "Draft saved <time>" updates
    And [Code] announcement_drafts upsert invoked once
    And [DB] announcement_drafts.payload->>'body' equals typed text$$,
 'not_built', 'e2e', 'e2e/admin/announcements-author.e2e.ts', ''),

('Project Opening Display', 4121, 'W1-POD-001', 'Anonymous can view a public project opening',
$$Feature: Public access
  Scenario: Anonymous opens shareable URL
    Given project_openings row with is_public=true
    When anonymous visits /projects/<slug>
    Then [UI] detail page renders header + roles + apply CTA
    And [Code] project_openings select returns 1 row under anon RLS
    And [DB] no audit_log row written for anon view$$,
 'not_built', 'e2e', 'e2e/projects/public-opening.e2e.ts', ''),

('Error Triage', 4122, 'W1-ET-001', 'Triage daily digest posts at 15:00 UTC',
$$Feature: Digest cron
  Scenario: Daily cron triggers digest
    Given pg_cron schedule for triage-daily-digest at 15:00 UTC
    When cron fires
    Then [Code] triage-daily-digest returns 200 discord_posted=true
    And [DB] one transactional_emails row per admin and one discord_messages row
    And [UI] Triage tab shows "Last digest: today 15:00 UTC"$$,
 'not_built', 'manual', '', ''),

('Discord Connection', 4123, 'W1-DC-001', 'Member links Discord identity',
$$Feature: Discord OAuth linking
  Scenario: Member completes Discord OAuth
    Given a member on /profile with no Discord link
    When they complete OAuth
    Then [UI] Discord badge appears with username
    And [Code] discord-link edge fn returns 200
    And [DB] discord_identities row exists with discord_user_id$$,
 'not_built', 'e2e', 'e2e/discord-verification.e2e.ts', 'Extend existing spec.'),

('Project Interview Toggle', 4124, 'W1-PIT-001', 'Admin enables interviews for a project',
$$Feature: Interview toggle
  Scenario: Admin flips interviews=true
    Given an admin on a project edit page
    When they toggle and save
    Then [UI] project card shows Interviews badge
    And [Code] projects update returns 200
    And [DB] projects.interviews_required=true; audit_log row written$$,
 'not_built', 'e2e', 'e2e/admin/project-edit.e2e.ts', ''),

('Brand Voice', 4125, 'W1-BV-001', 'Banned terms ESLint rule fails on "click here"',
$$Feature: Brand voice enforcement
  Scenario: Developer writes a banned term
    Given brand-terms ESLint rule active
    When lint runs
    Then [Code] eslint exits non-zero with banned-term diagnostic
    And [UI] n/a
    And [DB] n/a$$,
 'not_built', 'unit', 'src/test/lint/brand-terms.test.ts', ''),

('Network Activity', 4126, 'W1-NA-001', 'Activity feed badge matches aggregator',
$$Feature: Network Activity badge
  Scenario: Member opens /network with 7 new items
    Given network_events has 7 rows newer than member''s last_seen_at
    When they navigate to /network
    Then [UI] tab badge shows "7"
    And [Code] network_activity_count RPC returns 7
    And [DB] profile.network_last_seen_at updates on open$$,
 'not_built', 'e2e', 'e2e/network/activity-feed.e2e.ts', ''),

('Accessibility', 4127, 'W1-A11Y-001', 'Keyboard walk reaches every control on /dashboard',
$$Feature: Keyboard-only navigation
  Scenario: Member tabs through /dashboard
    Given a signed-in member on /dashboard
    When they press Tab repeatedly
    Then [UI] every native focusable and role=button shows a visible focus ring
    And [Code] no console error about focus traps
    And [DB] n/a$$,
 'not_built', 'e2e', 'e2e/a11y/keyboard-walk.e2e.ts', ''),
('Accessibility', 4127, 'W1-A11Y-002', 'Live announcer announces route changes',
$$Feature: Route-change a11y
  Scenario: Member navigates from /dashboard to /journey
    Given LiveAnnouncer mounted in AppLayout
    When the route changes
    Then [Code] useRouteAnnouncer pushes "Journey page" into the live region
    And [UI] aria-live=polite region contains the page title
    And [DB] n/a$$,
 'not_built', 'unit', 'src/test/a11y/route-announcer.test.tsx', ''),

('Security', 4128, 'W1-SEC-EFN-001', 'Every protected edge function rejects missing JWT',
$$Feature: Edge function auth gate
  Scenario: Anonymous calls every protected edge fn
    Given the list of protected edge functions
    When each is invoked with no Authorization header
    Then [Code] response status is 401 for every protected function
    And [DB] no side-effect rows written
    And [UI] n/a$$,
 'not_built', 'unit', 'src/test/edge/auth-gate-matrix.test.ts', ''),
('Security', 4128, 'W1-SEC-RLS-001', 'RLS matrix passes for new tables',
$$Feature: RLS smoke matrix
  Scenario: anon and authenticated probes against new tables
    Given new tables: cookie_consents, dsar_requests, agent_fix_queue, web_vital_samples, ugc_translations
    When each is probed as anon and a non-owner authenticated user
    Then [Code] only documented public reads succeed
    And [DB] no unauthorized rows returned
    And [UI] n/a$$,
 'not_built', 'unit', 'src/test/db/rls-matrix.test.ts', ''),

('Applications', 4129, 'W1-APP-001', 'Member submits a project application end-to-end',
$$Feature: 3-step application flow
  Scenario: Member completes the sticky 3-step form
    Given a member who signed CCA on an open project
    When they fill all 3 steps and submit
    Then [UI] success page shows "Application received" and tracker timeline
    And [Code] submit-application edge fn returns 201
    And [DB] project_applications row exists; coordinator notification inserted$$,
 'not_built', 'e2e', 'e2e/applications/general-application.e2e.ts', ''),

('Performance', 4130, 'W1-PRF-001', 'LCP beacon reaches record-web-vital',
$$Feature: RUM beacon
  Scenario: Member loads /dashboard, LCP fires
    Given a member with analytics consent
    When LCP fires
    Then [Code] sendBeacon hits record-web-vital with metric=LCP
    And [DB] web_vital_samples row inserted with metric=LCP and value > 0
    And [UI] Performance tab shows new sample within 60s$$,
 'not_built', 'unit', 'src/test/perf/web-vital-beacon.test.ts', '')
;
