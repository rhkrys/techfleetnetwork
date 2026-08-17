<!-- AUTHORITATIVE OWASP COVERAGE MAP — checked by scripts/ci/check-owasp-coverage.mjs -->

# OWASP Cheat Sheet Series — Coverage Map (all 120)

This file is the **machine-enforced** proof that every one of the 120 OWASP Cheat
Sheets is accounted for on anything that deploys. `scripts/ci/check-owasp-coverage.mjs`
(wired into the required `ci / gate`) fails the build if:

- any of the 120 canonical cheat sheets is missing from the table below, or a name
  is misspelled / not one of the 120;
- an `sast:<ID>` reference names a rule that does not exist in
  `scripts/pentest/sast.mjs`;
- a `check:`, `workflow:`, or `doc:` reference points at a file that does not exist;
- a `pentest:` reference names a suite that does not exist;
- a `pgtap` reference is used but `supabase/tests/` has no suites;
- an `n/a:` or `config:` row omits its required justification text.

So "100% coverage" is not a claim in prose — it is a build gate. Adding a new cheat
sheet (bump the canonical list), or deleting a SAST rule a sheet relied on, breaks CI
until the map is honest again.

## Enforcement token grammar

Each row's **Enforcement** column is one or more `; `-separated tokens:

| Token             | Meaning                                                                   | Validated?                  |
| ----------------- | ------------------------------------------------------------------------- | --------------------------- |
| `sast:<RULE-ID>`  | Static rule in `scripts/pentest/sast.mjs`                                 | ID must exist               |
| `check:<path>`    | Standalone CI guard script                                                | file must exist             |
| `workflow:<path>` | GitHub Actions workflow                                                   | file must exist             |
| `pentest:<suite>` | Runtime pen-test suite (`db-rls`/`edge-functions`/`web-http`/`sast`)      | suite must be valid         |
| `pgtap`           | pgTAP DB proofs in `supabase/tests/`                                      | suite dir must be non-empty |
| `doc:<path>`      | Design/process artifact (ADR, threat model, checklist)                    | file must exist             |
| `config:<reason>` | Enforced in infrastructure/managed config (Cloudflare/Nginx/Supabase)     | reason required             |
| `n/a:<reason>`    | Not applicable to this stack (Vite+React+TS / Supabase/Deno / Cloudflare) | reason required             |

`config:` and `n/a:` are the only categories the scanner cannot mechanically verify;
they carry an explicit written reason so the exception is reviewed in the diff, never
silent. Stack facts that drive most `n/a:` rows: no Java/.NET/PHP/Ruby/Python runtime,
no native mobile app, no self-managed Kubernetes/containers/network, no NoSQL/LDAP, no
GraphQL/gRPC/SAML, no self-trained ML models.

## Coverage table

| Cheat Sheet                                 | Cluster      | Status   | Enforcement                                                                                                                                        |
| ------------------------------------------- | ------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI Agent Security                           | AI/LLM       | enforced | sast:SAST-LLM-MCP-TOOL-GUARDS                                                                                                                      |
| AJAX Security                               | XSS/CSRF     | enforced | sast:SAST-SHARED-JSON-SECURITY-HEADERS                                                                                                             |
| AML Sanctions AI Agent Payments             | AI/LLM       | enforced | sast:SAST-PAYMENT-TRANSACTION-AUTH-GUARDS                                                                                                          |
| Abuse Case                                  | Design       | process  | workflow:.github/workflows/bdd-gate.yml                                                                                                            |
| Access Control                              | AuthZ        | enforced | pentest:db-rls; pgtap                                                                                                                              |
| Attack Surface Analysis                     | Design       | enforced | sast:SAST-PUBLIC-EDGE-ROUTE-JUSTIFICATION; sast:SAST-EDGE-FUNCTIONS-VERIFY-JWT-OR-EXPLICIT                                                         |
| Authentication                              | Auth         | enforced | check:scripts/ci/check-no-unsigned-jwt-auth.mjs; pentest:edge-functions                                                                            |
| Authorization                               | AuthZ        | enforced | sast:SAST-IDOR-OBJECT-ACCESS-HELPER; pentest:db-rls                                                                                                |
| Authorization Regression Testing            | AuthZ        | enforced | pgtap; workflow:.github/workflows/ci.yml                                                                                                           |
| Authorization Testing Automation            | AuthZ        | enforced | pentest:db-rls                                                                                                                                     |
| Automotive Security                         | Specialized  | n/a      | n/a:no vehicle/ECU/CAN-bus software in this product                                                                                                |
| Bean Validation                             | Language     | n/a      | n/a:no Java/Jakarta stack, input validation is zod (see Input Validation)                                                                          |
| Bot Management and Anti-Automation          | DoS          | config   | config:Cloudflare Turnstile challenge + Supabase rate-limit edge function on signup/login/reset                                                    |
| Browser Extension Vulnerabilities           | Language     | n/a      | n/a:ships no browser extension                                                                                                                     |
| Business Logic Security                     | Design       | enforced | sast:SAST-PAYMENT-TRANSACTION-AUTH-GUARDS; pgtap                                                                                                   |
| C-Based Toolchain Hardening                 | Language     | n/a      | n/a:no C/C++ source in this repo                                                                                                                   |
| CI/CD Security                              | Supply chain | enforced | sast:SAST-GITHUB-ACTIONS-PINNED-BY-SHA; sast:SAST-GITHUB-ACTIONS-LEAST-PRIVILEGE-PERMISSIONS; sast:SAST-GITHUB-ACTIONS-NO-UNTRUSTED-CONTEXT-IN-RUN |
| Choosing and Using Security Questions       | Auth         | enforced | sast:SAST-NO-SECURITY-QUESTION-AUTH                                                                                                                |
| Clickjacking Defense                        | Headers      | enforced | pentest:web-http; config:CSP frame-ancestors at Cloudflare/Nginx                                                                                   |
| Content Security Policy                     | Headers      | enforced | pentest:web-http; config:CSP set at the CDN/edge                                                                                                   |
| Cookie Theft Mitigation                     | Sessions     | enforced | sast:SAST-CLIENT-COOKIE-SAMESITE-SECURE                                                                                                            |
| Credential Stuffing Prevention              | Auth         | config   | config:Turnstile + rate-limit + generic auth errors on the login path                                                                              |
| Cross-Site Request Forgery Prevention       | XSS/CSRF     | enforced | sast:SAST-EDGE-JSON-REQUESTS-USE-BOUNDED-PARSER; sast:SAST-CLIENT-COOKIE-SAMESITE-SECURE                                                           |
| Cross Site Scripting Prevention             | XSS/CSRF     | enforced | sast:SAST-NO-DANGEROUSLY-SET-INNER-HTML-WITHOUT-SANITIZE; sast:SAST-NO-DANGEROUS-DOM-SINKS                                                         |
| Cryptographic Storage                       | Crypto       | enforced | sast:SAST-NO-WEAK-HASH; pentest:db-rls                                                                                                             |
| DOM Clobbering Prevention                   | XSS/CSRF     | enforced | sast:SAST-DOMPURIFY-DOM-CLOBBERING-GUARDS; sast:SAST-NO-DOCUMENT-WRITE                                                                             |
| DOM based XSS Prevention                    | XSS/CSRF     | enforced | sast:SAST-NO-DANGEROUS-DOM-SINKS; sast:SAST-NO-EVAL                                                                                                |
| Database Security                           | Data         | enforced | sast:SAST-NO-RAW-SQL-EXECUTION; sast:SAST-RLS-MIGRATIONS-PRESENT; pentest:db-rls                                                                   |
| Denial of Service                           | DoS          | enforced | sast:SAST-EDGE-JSON-REQUESTS-USE-BOUNDED-PARSER; config:Supabase rate-limit + Cloudflare                                                           |
| Dependency Graph SBOM                       | Supply chain | enforced | sast:SAST-SBOM-SCRIPT-PRESENT                                                                                                                      |
| Deserialization                             | Files/SSRF   | enforced | sast:SAST-PROTOTYPE-POLLUTION-RECURSIVE-GUARDS; sast:SAST-EDGE-JSON-REQUESTS-USE-BOUNDED-PARSER                                                    |
| Django REST Framework                       | Language     | n/a      | n/a:no Django/Python stack                                                                                                                         |
| Django Security                             | Language     | n/a      | n/a:no Django/Python stack                                                                                                                         |
| Docker Security                             | Container    | n/a      | n/a:app ships as static dist served by Cloudflare/Nginx, no application container image built                                                      |
| DotNet Security                             | Language     | n/a      | n/a:no .NET/C# stack                                                                                                                               |
| Drone Security                              | Specialized  | n/a      | n/a:no UAV/drone systems                                                                                                                           |
| Email Validation and Verification           | Auth         | enforced | sast:SAST-EMAIL-VALIDATION-CENTRALIZED                                                                                                             |
| Error Handling                              | Logging      | enforced | sast:SAST-NO-STACKTRACE-TO-CLIENT                                                                                                                  |
| File Upload                                 | Files/SSRF   | enforced | sast:SAST-FILE-UPLOAD-ALLOWLISTS; sast:SAST-NO-SVG-UPLOADS                                                                                         |
| Forgot Password                             | Auth         | enforced | sast:SAST-FORGOT-PASSWORD-NON-ENUMERATING                                                                                                          |
| GitHub Actions Security                     | Supply chain | enforced | sast:SAST-GITHUB-ACTIONS-PINNED-BY-SHA; sast:SAST-GITHUB-ACTIONS-LEAST-PRIVILEGE-PERMISSIONS; sast:SAST-GITHUB-ACTIONS-NO-UNTRUSTED-CONTEXT-IN-RUN |
| GraphQL                                     | API          | enforced | sast:SAST-NO-GRAPHQL-PROD-INTROSPECTION                                                                                                            |
| gRPC Security                               | API          | n/a      | n/a:no gRPC services                                                                                                                               |
| HTML5 Security                              | XSS/CSRF     | enforced | sast:SAST-HTML5-POSTMESSAGE-ORIGIN; sast:SAST-NO-CLIENT-STORAGE-AUTHZ                                                                              |
| HTTP Headers                                | Headers      | enforced | pentest:web-http; config:security headers at the CDN/edge                                                                                          |
| HTTP Strict Transport Security              | Headers      | enforced | pentest:web-http; config:HSTS at Cloudflare                                                                                                        |
| Infrastructure as Code Security             | Supply chain | enforced | sast:SAST-IAC-NO-PERMISSIVE-PATTERNS                                                                                                               |
| Injection Prevention                        | Injection    | enforced | sast:SAST-REST-QUERY-PARAMETERIZATION-GUARDS; sast:SAST-NO-RAW-SQL-EXECUTION                                                                       |
| Injection Prevention in Java                | Injection    | n/a      | n/a:no Java stack                                                                                                                                  |
| Input Validation                            | Injection    | enforced | sast:SAST-REST-QUERY-PARAMETERIZATION-GUARDS; sast:SAST-PROTOTYPE-POLLUTION-RECURSIVE-GUARDS                                                       |
| Insecure Direct Object Reference Prevention | AuthZ        | enforced | sast:SAST-IDOR-OBJECT-ACCESS-HELPER; pentest:db-rls                                                                                                |
| JAAS                                        | Language     | n/a      | n/a:no Java stack                                                                                                                                  |
| JSON Web Token                              | Sessions     | enforced | sast:SAST-JWT-VERIFY-NOT-DECODE-ONLY; check:scripts/ci/check-no-unsigned-jwt-auth.mjs                                                              |
| Java Security                               | Language     | n/a      | n/a:no Java stack                                                                                                                                  |
| Key Management                              | Crypto       | enforced | sast:SAST-NO-HARDCODED-SECRETS; check:scripts/secret-scan.mjs                                                                                      |
| Kubernetes Security                         | Container    | n/a      | n/a:no self-managed Kubernetes, Cloudflare Pages + managed Supabase                                                                                |
| LDAP Injection Prevention                   | Injection    | n/a      | n/a:no LDAP directory in use                                                                                                                       |
| LLM Prompt Injection Prevention             | AI/LLM       | enforced | sast:SAST-LLM-MCP-TOOL-GUARDS                                                                                                                      |
| Laravel                                     | Language     | n/a      | n/a:no PHP/Laravel stack                                                                                                                           |
| Legacy Application Management               | Design       | process  | doc:docs/audits/full-system-audit-2026-08.md                                                                                                       |
| Logging                                     | Logging      | enforced | sast:SAST-LOGGING-STRUCTURED-REDACTED; sast:SAST-NO-CONSOLE-LOG-OF-SECRETS                                                                         |
| Logging Vocabulary                          | Logging      | enforced | sast:SAST-LOGGING-STRUCTURED-REDACTED                                                                                                              |
| MCP Security                                | AI/LLM       | enforced | sast:SAST-LLM-MCP-TOOL-GUARDS                                                                                                                      |
| Mass Assignment                             | Injection    | enforced | sast:SAST-MASS-ASSIGNMENT-ALLOWLIST-HELPERS                                                                                                        |
| Microservices Security                      | API          | enforced | sast:SAST-EDGE-FUNCTIONS-VERIFY-JWT-OR-EXPLICIT                                                                                                    |
| Microservices based Security Arch Doc       | API          | process  | doc:docs/adr                                                                                                                                       |
| Mobile Application Security                 | Mobile       | n/a      | n/a:responsive web app, no native iOS/Android client                                                                                               |
| Multi Tenant Security                       | AuthZ        | enforced | pentest:db-rls; sast:SAST-IDOR-OBJECT-ACCESS-HELPER                                                                                                |
| Multifactor Authentication                  | Auth         | config   | config:Supabase GoTrue MFA/AAL, step-up enforced server-side (see SAST-NO-CLIENT-STORAGE-AUTHZ)                                                    |
| NPM Security                                | Supply chain | enforced | sast:SAST-SBOM-SCRIPT-PRESENT; workflow:.github/workflows/security.yml; check:scripts/ci/check-no-stray-lockfiles.mjs                              |
| Network Segmentation                        | Cloud        | config   | config:managed PaaS network boundaries (Supabase/Cloudflare), no self-managed network                                                              |
| NoSQL Security                              | Injection    | n/a      | n/a:PostgreSQL only, no NoSQL datastore                                                                                                            |
| NodeJS Docker                               | Container    | n/a      | n/a:no Node container image shipped                                                                                                                |
| Nodejs Security                             | Language     | enforced | sast:SAST-NO-EVAL; sast:SAST-PROTOTYPE-POLLUTION-RECURSIVE-GUARDS                                                                                  |
| OAuth2                                      | Sessions     | enforced | check:scripts/ci/check-no-direct-google-oauth.mjs; config:Supabase GoTrue OAuth                                                                    |
| OS Command Injection Defense                | Injection    | enforced | sast:SAST-GITHUB-ACTIONS-NO-UNTRUSTED-CONTEXT-IN-RUN                                                                                               |
| PHP Configuration                           | Language     | n/a      | n/a:no PHP stack                                                                                                                                   |
| Password Storage                            | Auth         | enforced | sast:SAST-NO-MANUAL-PASSWORD-STORAGE; config:Supabase GoTrue bcrypt                                                                                |
| Pinning                                     | Transport    | n/a      | n/a:browser web app, TLS trust is browser/CA-managed so cert pinning not applicable                                                                |
| Prototype Pollution Prevention              | XSS/CSRF     | enforced | sast:SAST-PROTOTYPE-POLLUTION-RECURSIVE-GUARDS                                                                                                     |
| Query Parameterization                      | Injection    | enforced | sast:SAST-REST-QUERY-PARAMETERIZATION-GUARDS; sast:SAST-NO-RAW-SQL-EXECUTION                                                                       |
| RAG Security                                | AI/LLM       | enforced | sast:SAST-LLM-MCP-TOOL-GUARDS                                                                                                                      |
| REST Assessment                             | API          | enforced | pentest:edge-functions; pentest:web-http                                                                                                           |
| REST Security                               | API          | enforced | sast:SAST-SHARED-JSON-SECURITY-HEADERS; sast:SAST-EDGE-FUNCTIONS-VERIFY-JWT-OR-EXPLICIT                                                            |
| Ruby on Rails                               | Language     | n/a      | n/a:no Ruby/Rails stack                                                                                                                            |
| SAML Security                               | Sessions     | n/a      | n/a:no SAML SSO in use                                                                                                                             |
| SQL Injection Prevention                    | Injection    | enforced | sast:SAST-NO-RAW-SQL-EXECUTION; sast:SAST-REST-QUERY-PARAMETERIZATION-GUARDS; pentest:db-rls                                                       |
| Secrets Management                          | Crypto       | enforced | sast:SAST-NO-HARDCODED-SECRETS; check:scripts/secret-scan.mjs; workflow:.github/workflows/security.yml                                             |
| Secure AI Model Ops                         | AI/LLM       | n/a      | n/a:uses hosted LLM APIs, no self-trained/served models                                                                                            |
| Secure Cloud Architecture                   | Cloud        | enforced | sast:SAST-IAC-NO-PERMISSIVE-PATTERNS; sast:SAST-SSRF-CLOUD-BOUNDARY-GUARDS                                                                         |
| Secure Code Review                          | Design       | process  | doc:docs/code-review-checklist.md                                                                                                                  |
| Secure Coding with AI                       | Design       | process  | doc:CLAUDE.md; workflow:.github/workflows/ci.yml                                                                                                   |
| Secure Product Design                       | Design       | process  | doc:docs/adr                                                                                                                                       |
| Securing Cascading Style Sheets             | XSS/CSRF     | enforced | sast:SAST-CSS-UNTRUSTED-STYLING-GUARDS                                                                                                             |
| Security Terminology                        | Design       | process  | doc:docs/security                                                                                                                                  |
| Server Side Request Forgery Prevention      | Files/SSRF   | enforced | sast:SAST-SSRF-CLOUD-BOUNDARY-GUARDS; pentest:edge-functions                                                                                       |
| Serverless FaaS Security                    | Cloud        | enforced | sast:SAST-EDGE-FUNCTIONS-VERIFY-JWT-OR-EXPLICIT; sast:SAST-PUBLIC-EDGE-ROUTE-JUSTIFICATION                                                         |
| Session Management                          | Sessions     | enforced | sast:SAST-SESSION-MANAGEMENT-GUARDS; pentest:db-rls                                                                                                |
| Software Supply Chain Security              | Supply chain | enforced | sast:SAST-SBOM-SCRIPT-PRESENT; sast:SAST-GITHUB-ACTIONS-PINNED-BY-SHA; workflow:.github/workflows/security.yml                                     |
| Subdomain Takeover Prevention               | Cloud        | config   | config:DNS/CNAME lifecycle managed at Cloudflare, dangling-record hygiene is an ops runbook                                                        |
| Symfony                                     | Language     | n/a      | n/a:no PHP/Symfony stack                                                                                                                           |
| TLS Cipher String                           | Transport    | config   | config:TLS termination + cipher policy at Cloudflare/Nginx                                                                                         |
| Third Party Javascript Management           | Supply chain | enforced | sast:SAST-REDIRECT-TLS-THIRD-PARTY-GUARDS                                                                                                          |
| Third Party Payment Gateway Integration     | Design       | enforced | sast:SAST-PAYMENT-TRANSACTION-AUTH-GUARDS                                                                                                          |
| Threat Modeling                             | Design       | process  | doc:docs/security/fleety-threat-model.md; doc:docs/threat-model-spf-handoff.md                                                                     |
| Transaction Authorization                   | Sessions     | enforced | sast:SAST-PAYMENT-TRANSACTION-AUTH-GUARDS                                                                                                          |
| Transport Layer Protection                  | Transport    | enforced | pentest:web-http; config:HTTPS-only + HSTS at Cloudflare                                                                                           |
| Transport Layer Security                    | Transport    | enforced | pentest:web-http; config:TLS 1.2+ at Cloudflare                                                                                                    |
| Unvalidated Redirects and Forwards          | XSS/CSRF     | enforced | sast:SAST-REDIRECT-TLS-THIRD-PARTY-GUARDS                                                                                                          |
| User Privacy Protection                     | Design       | enforced | sast:SAST-PRIVACY-VIRTUAL-PATCH-ZERO-TRUST-GUARDS; pgtap                                                                                           |
| Virtual Patching                            | Design       | enforced | sast:SAST-PRIVACY-VIRTUAL-PATCH-ZERO-TRUST-GUARDS                                                                                                  |
| Vulnerability Disclosure                    | Design       | process  | doc:docs/security                                                                                                                                  |
| Vulnerable Dependency Management            | Supply chain | enforced | sast:SAST-DEPENDENCY-RISK-ACCEPTANCE-GUARDS; workflow:.github/workflows/security.yml; workflow:.github/workflows/ci.yml                            |
| Web Service Security                        | API          | enforced | sast:SAST-WEBSOCKET-WEB-SERVICE-XXE-GUARDS                                                                                                         |
| WebSocket Security                          | API          | enforced | sast:SAST-WEBSOCKET-WEB-SERVICE-XXE-GUARDS                                                                                                         |
| XML External Entity Prevention              | Files/SSRF   | enforced | sast:SAST-WEBSOCKET-WEB-SERVICE-XXE-GUARDS                                                                                                         |
| XML Security                                | Files/SSRF   | enforced | sast:SAST-WEBSOCKET-WEB-SERVICE-XXE-GUARDS                                                                                                         |
| XS Leaks                                    | XSS/CSRF     | enforced | sast:SAST-SHARED-JSON-SECURITY-HEADERS; config:CORP/COOP/COEP at the edge                                                                          |
| XSS Filter Evasion                          | XSS/CSRF     | enforced | sast:SAST-NO-DANGEROUS-DOM-SINKS; pentest:web-http                                                                                                 |
| Zero Trust Architecture                     | Cloud        | enforced | sast:SAST-PRIVACY-VIRTUAL-PATCH-ZERO-TRUST-GUARDS                                                                                                  |

## When you add a feature

Follow the `owasp-secure-coding-bdd` workflow: map the attack surface to the sheets
above, apply the control, and add a `@security` BDD scenario. If a feature introduces a
surface a sheet marked `n/a` now covers (e.g. the first file-serving container, a native
mobile app, a GraphQL endpoint), flip that row to `enforced`/`config` and add the
enforcing control in the same PR — the gate will remind you, but the judgment is yours.
