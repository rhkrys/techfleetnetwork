INSERT INTO public.bdd_scenarios (feature_area, feature_area_number, scenario_id, title, gherkin, status, test_type, notes)
SELECT 'privacy-cookies', COALESCE((SELECT MAX(feature_area_number) FROM public.bdd_scenarios WHERE feature_area='privacy-cookies'), 0) + row_number() OVER (), scenario_id, title, gherkin, 'not_built'::bdd_status, 'manual'::bdd_test_type, notes
FROM (VALUES
('CLARITY-RECOVERY-001', 'Returning visitor with stored CookieYes analytics consent loads Clarity on next session',
$$Scenario: Returning visitor with stored consent
  Given a visitor previously accepted analytics in CookieYes
  And they return in a brand-new browser session
  When the app boots and CookieConsentBanner mounts
  Then [Code] readStoredCookieYesConsent returns analytics=true
  And [Code] applyConsent loads clarity.ms
  And [Code] window.clarity('consentv2', { analytics_Storage: 'granted' }) is called
  And [UI] no cookie banner is shown
  And [DB] one cookie_consents row is written with source backfill$$,
'Retroactive Clarity init for prior consenters'),
('CLARITY-RECOVERY-002', 'Active session reconciles on SPA route change',
$$Scenario: Mid-session reconciliation
  Given consent was granted earlier but the banner event was missed
  When the visitor navigates to a new route
  Then [Code] route-change useEffect calls reconcileFromCookieYes
  And [Code] Clarity script is injected exactly once via sessionStorage dedup
  And [DB] cookie_consents has at most one row per fingerprint per session$$,
'Currently-active users recover on next nav'),
('CLARITY-RECOVERY-003', 'Tab visibility return triggers reconciliation',
$$Scenario: Backgrounded tab returns
  Given consent was granted in another tab
  When the tab becomes visible again
  Then [Code] visibilitychange fires reconcileFromCookieYes
  And [Code] Clarity loads if analytics consent is granted and GPC is off$$,
'Cross-tab consent propagation'),
('CLARITY-RECOVERY-004', 'GPC overrides stored CookieYes analytics consent',
$$Scenario: GPC blocks Clarity
  Given stored analytics consent is yes
  And navigator.globalPrivacyControl is true
  When reconcile runs
  Then [Code] ckyToConsentState returns analytics=false
  And [Code] clarity.ms is never loaded
  And [Code] consentv2 sends analytics_Storage denied$$,
'GPC always wins'),
('CLARITY-RECOVERY-005', 'CookieYes blocked falls back to first-party state',
$$Scenario: Ad-blocker prevents CookieYes
  Given CookieYes fails to load
  And tfn.consent.v1 contains analytics=true
  When the app boots
  Then [Code] bootstrapConsent returns analytics=true
  And [Code] applyConsent loads Clarity
  And [Code] readStoredCookieYesConsent returns null safely$$,
'Resilience'),
('CLARITY-RECOVERY-006', 'Clarity consentv2 signal sent with correct payload',
$$Scenario: Consent Mode v2 signal
  Given analytics granted and marketing denied
  When applyConsent runs
  Then [Code] window.clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' }) is called
  And [Code] window.clarity('consent', true) is also called$$,
'Microsoft Consent Mode v2'),
('CLARITY-RECOVERY-007', 'record-consent dedupe prevents duplicate rows per session',
$$Scenario: SPA navigation does not spam consent log
  Given reconcile already ran this session
  When same fingerprint reconciled again
  Then [Code] sessionStorage tfn.consent.fp.v1 matches new fingerprint
  And [Code] record-consent is NOT invoked a second time
  And [DB] cookie_consents has one row per anon_id and fingerprint$$,
'Prevents log spam')
) AS v(scenario_id, title, gherkin, notes)
ON CONFLICT (scenario_id) DO NOTHING;