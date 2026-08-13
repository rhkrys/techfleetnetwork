Feature: Hand-off output download (server-issued signed URL)
  As an active teammate, so I can read/download a produced hand-off, I request a
  short-lived signed URL for an output file. Access is re-checked on every request;
  the private bucket has no blanket read policy. (Phase B3.)

  Background:
    Given the handoff-download endpoint is deployed
    And I am signed in

  Scenario: An active member gets a short-lived signed URL for their project's output
    Given I am an active_participant on the project that owns output file F
    When I request a download URL for F
    Then I receive a signed URL that expires within 60 seconds

  # ── @security — threat model (STRIDE) ────────────────────────────────────────
  @security
  Scenario: A teammate on another project cannot download this project's output (IDOR)
    Given output file F belongs to project X
    And I am an active_participant only on project Y
    When I request a download URL for F
    Then the request is rejected with 403 or 404
    And no signed URL is issued

  @security
  Scenario: A non-member cannot download any output (Broken access control)
    Given I am not an active_participant on the owning project
    When I request a download URL for F
    Then the request is rejected

  @security
  Scenario: URL secrecy is not the control — ownership is re-checked every request (IDOR)
    Given a signed URL for F previously issued to an authorized member
    When a non-member requests a new URL for F
    Then issuance is denied by the ownership check, not merely by URL obscurity

  @security
  Scenario: A malformed output id is rejected (Input validation)
    When I request a download URL for a non-uuid id
    Then the request is rejected with 400
