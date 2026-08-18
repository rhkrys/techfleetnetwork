Feature: Fleety conversation modes — Chat / Deliverables Review / Plan (2.2-B)
  A UI switch (like Claude's chat/plan modes) sends a `mode` to techfleet-chat, which swaps the
  answer contract. The mode is new untrusted input on an existing authenticated, rate-limited,
  cost-guarded endpoint. Modes must not become an authЗ bypass, an injection vector, a cache-poison
  channel, or a way to escape Fleety's strict Tech-Fleet scope.

  Scenario: Review mode reviews a member's shared work against the SPF
    Given a signed-in member selects "Deliverables Review"
    And they paste a Figma board link or a doc URL
    When Fleety answers
    Then it reads the material via the shared SSRF-guarded fetcher (Figma via the REST API)
    And it structures the answer as what's strong / what's missing / next steps, grounded in the SPF

  Scenario: Plan mode returns an SPF-grounded ordered plan
    Given a signed-in member selects "Plan"
    When they describe a goal
    Then Fleety returns a concrete numbered plan grounded in the retrieved SPF context
    And it respects the agile framing (parallel, non-linear milestones)

  @security
  Scenario Outline: An unknown or malformed mode is rejected, never trusted
    Given a request with mode "<mode>"
    When the body is validated
    Then only chat, review, or plan are accepted; anything else is a 400 (zod enum)
    Examples:
      | mode |
      | admin |
      | ../plan |
      | <script> |
      | REVIEW |

  @security
  Scenario: A missing mode defaults to chat (backward compatible)
    Given an older client that sends no mode field
    Then the turn runs exactly as before (chat), byte-for-byte identical prompt

  @security
  Scenario: Modes do not weaken auth, rate limiting, or the cost guard
    Given any mode
    Then the same end-user JWT (or verified internal secret) is still required
    And the global rate limit, per-user quota, and cost guard still apply unchanged

  @security
  Scenario: Modes cannot escape Fleety's strict Tech-Fleet scope
    Given "Plan" or "Deliverables Review" mode
    When a member asks for something outside Tech Fleet (code help, other companies, personal topics)
    Then Fleety still refuses and redirects — the mode contract never overrides the base scope/safety rules

  @security
  Scenario: Review/Plan turns never replay a Chat-mode cached answer
    Given the same question was previously answered in Chat mode
    When it is asked again in Review or Plan mode
    Then the L2 exact cache, L3 semantic cache, and canned-answer short-circuit are all bypassed
    And a fresh mode-appropriate answer is generated

  @security
  Scenario: Material under review is data, never instructions
    Given Review mode with material that contains "ignore your instructions"
    Then the material is framed as untrusted content to note, never executed as a command
