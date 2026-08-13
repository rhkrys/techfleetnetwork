Feature: Hand-off deliverable submission (intake)
  As an active teammate on a project, so our hand-off can be produced, I submit
  deliverables (text, links, or files) against the 26 hand-off components. Every
  submission is validated server-side before it is stored. (Phase B1.)

  Background:
    Given the handoff-submit endpoint is deployed
    And I am signed in

  # ── Functional ──────────────────────────────────────────────────────────────
  Scenario: An active teammate submits a text entry for a component
    Given I am an active_participant on project X
    When I submit text "We prioritized the checkout problem" for component "part-1-empathy-building"
    Then the submission is stored for project X, phase and component
    And the completeness for that component becomes complete

  Scenario: An active teammate submits a Figma link
    Given I am an active_participant on project X
    When I submit a "figma" link "https://figma.com/file/abc" for a component
    Then the submission is stored as an external link

  Scenario: An active teammate uploads a PDF deliverable
    Given I am an active_participant on project X
    When I upload a file whose content is a valid PDF
    Then the file is stored in the handoff-deliverables bucket under project X
    And a file submission row is recorded

  # ── @security — threat model (STRIDE) ────────────────────────────────────────
  @security
  Scenario: A non-member cannot submit to a project (Broken access control / IDOR)
    Given I am NOT an active_participant on project X
    When I submit any deliverable for project X
    Then the request is rejected with 403
    And nothing is written for project X

  @security
  Scenario: File type is decided by content, not the client-declared name (Spoofing/Upload)
    Given a file named "diagram.png" whose bytes are actually an executable
    When I upload it
    Then the upload is rejected because the content is not an allowed type
    And no object is written to storage

  @security
  Scenario: Word/Excel (zip-container) uploads are refused until decompression-safe (DoS/Upload)
    Given a file whose content is a ZIP-based office document
    When I upload it
    Then the upload is rejected with guidance to use PDF, CSV, or text

  @security
  Scenario Outline: Link submissions block internal/SSRF targets and non-https (SSRF)
    When I submit a "url" link "<url>"
    Then the submission is rejected
    Examples:
      | url                                      |
      | http://example.com/doc                   |
      | https://169.254.169.254/latest/meta-data |
      | https://127.0.0.1/admin                  |
      | https://10.0.0.5/internal                |

  @security
  Scenario: A figma link must be on a figma.com host (SSRF/validation)
    When I submit a "figma" link "https://evil.example.com/file/abc"
    Then the submission is rejected

  @security
  Scenario: Text over 10,000 characters is rejected (DoS/business rule)
    When I submit a text entry of 10,001 characters
    Then the submission is rejected

  @security
  Scenario: Client cannot set ownership or status fields (Mass assignment)
    Given I am an active_participant on project X
    When I submit a deliverable whose body also contains created_by, project ownership, or role fields
    Then those fields are ignored and created_by is taken from my authenticated identity

  @security
  Scenario: Oversized request bodies are rejected before processing (Denial of service)
    When I submit a request body larger than the configured cap
    Then the endpoint returns 413 without storing anything

  @security @lockout-prevention
  Scenario: A teammate can remove a submission they added (reversible, no dead end)
    Given I added a submission for component "pre-amble-6"
    When I delete that submission
    Then it is removed and the component's completeness reflects the removal
    # Submitting is reversible by the author; the strict gate simply re-closes.
