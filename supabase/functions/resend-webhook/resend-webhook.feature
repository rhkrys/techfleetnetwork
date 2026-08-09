Feature: Resend delivery-event ingestion (email observability + suppression)
  As the platform, so we stop sending blind, Resend's post-send events
  (bounce/complaint/delivered) are ingested to suppress bad addresses and make
  System Health → Deliverability + the auto-pause truthful.

  Background:
    Given the resend-webhook endpoint is deployed
    And RESEND_WEBHOOK_SECRET is configured

  # ── Functional ────────────────────────────────────────────────────────────
  Scenario: A hard bounce suppresses the recipient and logs it
    Given a signed "email.bounced" event for "bounce@example.com"
    When it is delivered to the webhook
    Then "bounce@example.com" is added to suppressed_emails with reason "bounce"
    And an email_send_log row with status "bounced" is appended

  Scenario: A spam complaint suppresses the recipient
    Given a signed "email.complained" event for "complainer@example.com"
    When it is delivered to the webhook
    Then "complainer@example.com" is suppressed with reason "complaint"

  Scenario: A delivered event never restricts sending
    Given a signed "email.delivered" event for "ok@example.com"
    When it is delivered to the webhook
    Then no suppression row is written for "ok@example.com"
    And the endpoint returns 200

  # ── @security — threat model (STRIDE) ───────────────────────────────────────
  @security
  Scenario: Unsigned events are rejected before any write (Spoofing)
    Given an event with no valid Svix signature
    When it is delivered to the webhook
    Then the endpoint returns 401
    And no row is written to suppressed_emails or email_send_log

  @security
  Scenario: A forged bounce cannot suppress an arbitrary address (Abuse case)
    Given an attacker crafts an "email.bounced" event for "victim@example.com" without the signing secret
    When it is delivered to the webhook
    Then signature verification fails and the endpoint returns 401
    And "victim@example.com" is NOT suppressed

  @security
  Scenario: Replayed (stale-timestamp) events are rejected (Tampering/Replay)
    Given a previously-valid signed event whose svix-timestamp is outside the tolerance window
    When it is re-delivered to the webhook
    Then verification fails and nothing is written

  @security
  Scenario: Transient delivery delay does not suppress (Business logic)
    Given a signed "email.delivery_delayed" event for "slow@example.com"
    When it is delivered to the webhook
    Then "slow@example.com" is NOT suppressed

  @security
  Scenario: Recipient PII is redacted in logs (Information disclosure)
    Given a signed bounce event for "person@example.com"
    When it is processed
    Then any log line shows the email masked (e.g. "p***@example.com"), never the full address

  @security
  Scenario: Oversized bodies are rejected (Denial of service)
    Given a request body larger than the 64KB cap
    When it is delivered to the webhook
    Then the endpoint returns 413 without processing

  @security @lockout-prevention
  Scenario: A wrongly-suppressed legitimate recipient can be restored
    Given "legit@example.com" was suppressed by a bounce event
    When an administrator removes it from suppressed_emails
    Then future sends to "legit@example.com" are no longer blocked
    # Suppression is reversible by admin — never a dead end.
