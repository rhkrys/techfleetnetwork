-- ============================================================================
-- BDD scenarios for Class Curriculum Authoring v2, seeded into bdd_scenarios
-- (the repo's CI-tracked feature index). Scenarios proven by the pgTAP suite
-- (supabase/tests/curriculum_v2_test.sql) and the release unit test are marked
-- 'implemented'; the two end-to-end journeys are 'not_built' until their
-- Playwright specs land, then flipped to 'implemented'.
-- ============================================================================
INSERT INTO public.bdd_scenarios
  (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, test_file, notes)
VALUES
('Class Curriculum Authoring', 31, 'CURR-GATE-001', 'Un-approved owner cannot author',
$g$Feature: Curriculum authoring — approval gate
  Scenario: An owner who lost the teacher role is blocked
    Given a user owns class C but no longer holds the 'teacher' role
    When they call upsert_class_module_item for a module in C
    Then [DB] the RPC raises forbidden (SQLSTATE 42501)
    And [DB] no class_module_items row is written$g$,
'implemented','both','supabase/tests/curriculum_v2_test.sql','F3'),

('Class Curriculum Authoring', 31, 'CURR-GATE-002', 'Admin can author any class',
$g$Feature: Curriculum authoring — approval gate
  Scenario: An admin authors curriculum
    Given an admin who does not own class C
    When they call upsert_class_section for C
    Then [DB] the section is created$g$,
'implemented','both','supabase/tests/curriculum_v2_test.sql','FR-GATE'),

('Class Curriculum Authoring', 31, 'CURR-GATE-003', 'Non-owner teacher cannot author',
$g$Feature: Curriculum authoring — approval gate
  Scenario: A teacher cannot author in a class they do not own
    Given teacher O who does not own class C
    When O calls upsert_class_module_item for a module in C
    Then [DB] the RPC raises forbidden (SQLSTATE 42501)$g$,
'implemented','both','supabase/tests/curriculum_v2_test.sql','SEC-02'),

('Class Curriculum Authoring', 31, 'CURR-REL-001', 'By-date locked module hides its body',
$g$Feature: Curriculum release gating (server-enforced)
  Scenario: A future by_date lock returns no body and no direct row
    Given class C uses release_policy 'by_date' with release_at in the future
    And module M in C is published and learner L is entitled
    When L calls get_class_curriculum_for_learner(C)
    Then [DB] M reports released=false and its content_html is omitted
    When L selects the class_module_items row for M directly
    Then [DB] no row is returned (RLS is release-aware)$g$,
'implemented','both','supabase/tests/curriculum_v2_test.sql','F1, SEC-03'),

('Class Curriculum Authoring', 31, 'CURR-REL-002', 'After-previous-completion drips in order',
$g$Feature: Curriculum release gating
  Scenario: The next module unlocks only after the previous is completed
    Given class C uses 'after_previous_completion' with required M1 then M2
    And learner L has not completed M1
    Then [DB] class_item_release(M2, L).released is false
    When L completes M1
    Then [DB] class_item_release(M2, L).released is true$g$,
'implemented','both','supabase/tests/curriculum_v2_test.sql','FR-RELEASE-04, F5'),

('Class Curriculum Authoring', 31, 'CURR-REL-003', 'Cohort-relative uses the learner''s own cohort',
$g$Feature: Curriculum release gating
  Scenario Outline: Two cohorts unlock on different dates
    Given class C uses 'relative_to_cohort_start' with an offset of <days> days
    And a learner whose cohort starts on <start>
    Then the item becomes available on <start> + <days>$g$,
'implemented','unit','src/features/class-curriculum/lib/release.test.ts','FR-RELEASE-05, F10'),

('Class Curriculum Authoring', 31, 'CURR-REL-004', 'All-at-once keeps today''s behavior',
$g$Feature: Curriculum release gating
  Scenario: Under all_at_once every published module is visible with no regression
    Given class C uses release_policy 'all_at_once'
    And module M in C is published and learner L is entitled
    Then [DB] M is released, its body is returned, and the direct row is readable$g$,
'implemented','both','supabase/tests/curriculum_v2_test.sql','backward-compat'),

('Class Curriculum Authoring', 31, 'CURR-PROG-001', 'Cannot complete an unreleased module',
$g$Feature: Completion integrity
  Scenario: Completing a locked module is rejected
    Given module M is published but not released to learner L
    When L calls toggle_class_module_completion(M, true)
    Then [DB] the RPC raises not_released and no progress row is written$g$,
'implemented','both','supabase/tests/curriculum_v2_test.sql','F5'),

('Class Curriculum Authoring', 31, 'CURR-FILE-001', 'Disallowed upload type is rejected',
$g$Feature: File content security
  Scenario: An executable MIME type is refused
    Given teacher T calls register_class_module_file with mime 'application/x-msdownload'
    Then [DB] the RPC raises a validation error and no attachment row is created$g$,
'implemented','both','supabase/tests/curriculum_v2_test.sql','SEC-05'),

('Class Curriculum Authoring', 31, 'CURR-FILE-002', 'Mismatched storage path is rejected (IDOR)',
$g$Feature: File content security
  Scenario: A storage path scoped to another class is refused
    Given teacher T calls register_class_module_file with a path for a different class
    Then [DB] the RPC raises invalid_path$g$,
'implemented','both','supabase/tests/curriculum_v2_test.sql','SEC-06'),

('Class Curriculum Authoring', 31, 'CURR-LINK-001', 'Unsafe link is rejected',
$g$Feature: Link content security
  Scenario: A javascript: URL is refused
    Given teacher T calls upsert_class_module_link with url 'javascript:alert(1)'
    Then [DB] the RPC raises invalid_url$g$,
'implemented','both','supabase/tests/curriculum_v2_test.sql','SEC-01/04, FR-CONTENT-05'),

('Class Curriculum Authoring', 31, 'CURR-SEC-001', 'Outsider cannot read the curriculum',
$g$Feature: Access control
  Scenario: A non-entitled user is forbidden from the learner read RPC
    Given user X is neither owner, admin, nor an entitled learner of class C
    When X calls get_class_curriculum_for_learner(C)
    Then [DB] the RPC raises forbidden (SQLSTATE 42501)$g$,
'implemented','both','supabase/tests/curriculum_v2_test.sql','SEC-02'),

('Class Curriculum Authoring', 31, 'CURR-SEC-002', 'Locked file bytes are unreachable',
$g$Feature: Access control
  Scenario: A learner cannot read a locked file object
    Given module M is published but not released to learner L
    Then [Storage] can_read_class_module_file for M's object returns false for L
    And [Storage] it returns true for the class owner (preview)$g$,
'implemented','both','supabase/tests/curriculum_v2_test.sql','SEC-05/06'),

('Class Curriculum Authoring', 31, 'CURR-DEL-001', 'Deleting a module needs a double confirmation',
$g$Feature: Delete safety
  Scenario: Hard delete behind two confirmations
    Given teacher T is editing a published module M
    When T clicks delete and confirms twice in the dialog
    Then [UI] delete_class_module_item(M) runs and M disappears from teacher and learner views
    And [UI] cancelling either confirmation leaves M intact$g$,
'not_built','e2e','e2e/classes/curriculum.e2e.ts','FR-DELETE-01, AC #6'),

('Class Curriculum Authoring', 31, 'CURR-LEARN-001', 'Learner sees only published + released, in order',
$g$Feature: Learner experience
  Scenario: Visibility, ordering, and lock states
    Given class C has published released modules, a draft module, and a locked module
    When entitled learner L opens the class curriculum
    Then [UI] L sees the published+released modules in saved order with a progress bar
    And [UI] L never sees the draft module
    And [UI] the locked module shows a lock and its availability$g$,
'implemented','e2e','e2e/classes/curriculum.e2e.ts','FR-LEARN-01/02/03')

ON CONFLICT (scenario_id) DO UPDATE
SET title = EXCLUDED.title, gherkin = EXCLUDED.gherkin,
    feature_area = EXCLUDED.feature_area, feature_area_number = EXCLUDED.feature_area_number,
    status = EXCLUDED.status, test_type = EXCLUDED.test_type,
    test_file = EXCLUDED.test_file, notes = EXCLUDED.notes, updated_at = now();
