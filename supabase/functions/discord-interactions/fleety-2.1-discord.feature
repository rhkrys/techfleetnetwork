# Fleety 2.1 — Discord /fleety delegates to the unified 2.0 brain (techfleet-chat) via an internal
# trusted-caller seam. Threat model + security requirements (owasp-secure-coding-bdd). Executable
# coverage lives in echo.test.ts / spf-links.test.ts / seam.test.ts (Deno) + the pgTAP RPC guards.

Feature: Discord /fleety on the unified 2.0 brain (Fleety 2.1)

  # ── Broken auth / the new trust boundary (authentication-session, api-tokens-microservices) ──
  @security
  Scenario: Internal seam rejects a missing or wrong shared secret
    Given techfleet-chat has FLEETY_INTERNAL_SECRET configured
    When a request arrives with no x-fleety-internal header or a wrong value
    Then it is NOT treated as internal and must present a valid end-user JWT
    And an anonymous/invalid caller receives 401, never the 2.0 answer

  @security
  Scenario: Shared secret is compared in constant time
    Given an x-fleety-internal header is presented
    Then the comparison runs in constant time over equal-length input
    And response timing does not reveal how many bytes matched

  @security
  Scenario: Fail closed on a weak or unset secret
    Given FLEETY_INTERNAL_SECRET is unset or shorter than 32 chars
    When any x-fleety-internal header is presented
    Then the request is NOT treated as internal (no brute-forceable bypass)
    And a config warning is logged without echoing the secret

  @security
  Scenario: Internal caller has no elevated privilege
    Given a valid internal call runs as the synthetic system id
    Then that id has no admin/elevated role and no auth.users row
    And it cannot reach any admin-gated RPC or cost-guard admin bypass

  # ── Rate / cost / DoS on the quota-skipping synthetic id (logging-error-handling-dos) ──
  @security
  Scenario: Global cost-guard and system rate-limit still apply to internal turns
    Given internal turns skip only the per-USER soft quota
    When the shared budget or system rate-limit is exhausted
    Then internal (Discord) turns are throttled/blocked like everyone else

  @security
  Scenario: Per-Discord-user rate limit bounds abuse at the source
    Given a single Discord user invokes /fleety repeatedly
    When they exceed the per-user hourly limit
    Then further calls are refused with a friendly notice before any 2.0 call

  # ── Untrusted content / prompt injection / output (ai-llm-agent-security) ──
  @security
  Scenario: Discord message content is subject to the 2.0 injection + scope gates
    Given a /fleety question contains a prompt-injection or jailbreak attempt
    Then the 2.0 handler's injection defense and strict-scope refusal apply
    And no system prompt, secret, or off-topic content is returned

  @security
  Scenario: Inappropriate content is refused, not answered
    When a /fleety question contains hateful/harassing/explicit content
    Then Fleety returns the firm-but-kind boundary and makes no LLM call

  @security
  Scenario: Public reply leaks no PII or other-user data
    Given the internal caller has no personal profile/roster context
    Then the answer contains no other user's data
    And output PII patterns are redacted before posting to the channel

  @security
  Scenario: The echoed question cannot be weaponised in-channel
    When the asked question contains @everyone, mentions, or markdown
    Then the "You asked:" echo neutralises pings and strips markdown

  # ── SSRF / egress + secrets + errors (file-upload-ssrf, cryptography-secrets) ──
  @security
  Scenario: Adapter egress target is fixed, never user-derived
    Given the adapter POSTs to techfleet-chat
    Then the URL is built from SUPABASE_URL env, never from Discord input
    And no request field can redirect the call to another host

  @security
  Scenario: Channel errors are generic
    When the 2.0 call fails or times out
    Then the user sees a generic "couldn't process" message
    And no stack trace, internal URL, or secret reaches the channel

  @security
  Scenario: The shared secret never appears in logs or responses
    Then FLEETY_INTERNAL_SECRET and the service-role key are never logged or returned

  # ── Availability of the rollout itself (lockout-prevention) ──
  @security @lockout-prevention
  Scenario: Endpoint repoint does not brick /fleety
    Given the new project must have the Discord + FLEETY_INTERNAL_SECRET set
    When the Interactions Endpoint URL is repointed to the new project
    Then secrets are set and the function deployed BEFORE the repoint
    And a failed Discord verification leaves the old endpoint in place

  @security @lockout-prevention
  Scenario: Secret rotation does not lock out the adapter
    Given FLEETY_INTERNAL_SECRET is a single env var both functions read
    When it is rotated
    Then both the adapter and techfleet-chat pick up the new value together
