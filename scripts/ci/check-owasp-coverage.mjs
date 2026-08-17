/**
 * check-owasp-coverage.mjs — the "100% OWASP cheat sheet coverage" gate.
 *
 * Proves, mechanically, that docs/security/owasp-coverage.md maps EVERY one of
 * the 120 OWASP Cheat Sheet Series sheets to a real, existing enforcement
 * mechanism (a SAST rule, a CI guard, a pen-test suite, pgTAP proofs, a workflow,
 * a design doc, or an explicitly justified config/N-A). It fails the build when:
 *
 *   - a canonical sheet is missing from the map, or the map lists a name that is
 *     not one of the 120 (typo / renamed sheet);
 *   - a sheet appears more than once;
 *   - an `sast:<ID>` reference names a rule that does not exist in
 *     scripts/pentest/sast.mjs;
 *   - a `check:`, `workflow:`, or `doc:` path does not exist on disk;
 *   - a `pentest:` suite is not one of the real suites;
 *   - a `pgtap` reference is used but supabase/tests/ has no suites;
 *   - an `n/a:` / `config:` row omits its required justification text;
 *   - a row has no enforcement tokens at all.
 *
 * No external dependencies — Node built-ins only, so it runs in the secret-free
 * `security-owasp` CI job with nothing but a checkout.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAP_PATH = "docs/security/owasp-coverage.md";
const SAST_PATH = "scripts/pentest/sast.mjs";
const PGTAP_DIR = "supabase/tests";
const PENTEST_SUITES = new Set(["db-rls", "edge-functions", "web-http", "sast"]);

// The authoritative 120 — kept verbatim from the OWASP Cheat Sheet Series index
// (owasp-secure-coding-bdd/references/owasp-full-index.md, "Full alphabetical
// checklist"). If the series adds/renames a sheet, update BOTH this list and the
// map together; the mismatch is exactly what this gate is here to catch.
const CANONICAL = [
  "AI Agent Security",
  "AJAX Security",
  "AML Sanctions AI Agent Payments",
  "Abuse Case",
  "Access Control",
  "Attack Surface Analysis",
  "Authentication",
  "Authorization",
  "Authorization Regression Testing",
  "Authorization Testing Automation",
  "Automotive Security",
  "Bean Validation",
  "Bot Management and Anti-Automation",
  "Browser Extension Vulnerabilities",
  "Business Logic Security",
  "C-Based Toolchain Hardening",
  "CI/CD Security",
  "Choosing and Using Security Questions",
  "Clickjacking Defense",
  "Content Security Policy",
  "Cookie Theft Mitigation",
  "Credential Stuffing Prevention",
  "Cross-Site Request Forgery Prevention",
  "Cross Site Scripting Prevention",
  "Cryptographic Storage",
  "DOM Clobbering Prevention",
  "DOM based XSS Prevention",
  "Database Security",
  "Denial of Service",
  "Dependency Graph SBOM",
  "Deserialization",
  "Django REST Framework",
  "Django Security",
  "Docker Security",
  "DotNet Security",
  "Drone Security",
  "Email Validation and Verification",
  "Error Handling",
  "File Upload",
  "Forgot Password",
  "GitHub Actions Security",
  "GraphQL",
  "gRPC Security",
  "HTML5 Security",
  "HTTP Headers",
  "HTTP Strict Transport Security",
  "Infrastructure as Code Security",
  "Injection Prevention",
  "Injection Prevention in Java",
  "Input Validation",
  "Insecure Direct Object Reference Prevention",
  "JAAS",
  "JSON Web Token",
  "Java Security",
  "Key Management",
  "Kubernetes Security",
  "LDAP Injection Prevention",
  "LLM Prompt Injection Prevention",
  "Laravel",
  "Legacy Application Management",
  "Logging",
  "Logging Vocabulary",
  "MCP Security",
  "Mass Assignment",
  "Microservices Security",
  "Microservices based Security Arch Doc",
  "Mobile Application Security",
  "Multi Tenant Security",
  "Multifactor Authentication",
  "NPM Security",
  "Network Segmentation",
  "NoSQL Security",
  "NodeJS Docker",
  "Nodejs Security",
  "OAuth2",
  "OS Command Injection Defense",
  "PHP Configuration",
  "Password Storage",
  "Pinning",
  "Prototype Pollution Prevention",
  "Query Parameterization",
  "RAG Security",
  "REST Assessment",
  "REST Security",
  "Ruby on Rails",
  "SAML Security",
  "SQL Injection Prevention",
  "Secrets Management",
  "Secure AI Model Ops",
  "Secure Cloud Architecture",
  "Secure Code Review",
  "Secure Coding with AI",
  "Secure Product Design",
  "Securing Cascading Style Sheets",
  "Security Terminology",
  "Server Side Request Forgery Prevention",
  "Serverless FaaS Security",
  "Session Management",
  "Software Supply Chain Security",
  "Subdomain Takeover Prevention",
  "Symfony",
  "TLS Cipher String",
  "Third Party Javascript Management",
  "Third Party Payment Gateway Integration",
  "Threat Modeling",
  "Transaction Authorization",
  "Transport Layer Protection",
  "Transport Layer Security",
  "Unvalidated Redirects and Forwards",
  "User Privacy Protection",
  "Virtual Patching",
  "Vulnerability Disclosure",
  "Vulnerable Dependency Management",
  "Web Service Security",
  "WebSocket Security",
  "XML External Entity Prevention",
  "XML Security",
  "XS Leaks",
  "XSS Filter Evasion",
  "Zero Trust Architecture",
];

const errors = [];
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// --- Collect the SAST rule IDs actually defined in the suite. -----------------
const sastRuleIds = new Set(
  [...read(SAST_PATH).matchAll(/id:\s*"([A-Z0-9-]+)"/g)].map((m) => m[1])
);

// --- Parse the coverage table. ------------------------------------------------
// Rows look like: | <name> | <cluster> | <status> | <enforcement> |
// The header/separator rows and the token-grammar table are skipped by requiring
// the last column to contain at least one recognized token form.
const mapText = read(MAP_PATH);
const rows = [];
for (const line of mapText.split("\n")) {
  if (!line.startsWith("|")) continue;
  const cells = line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
  if (cells.length !== 4) continue;
  const [name, , status, enforcement] = cells;
  if (name === "Cheat Sheet" || /^-+$/.test(name)) continue; // header/separator
  rows.push({ name, status, enforcement });
}

const seen = new Map();
for (const { name, status, enforcement } of rows) {
  if (seen.has(name)) errors.push(`Duplicate row for cheat sheet: "${name}"`);
  seen.set(name, { status, enforcement });

  const tokens = enforcement
    .split(";")
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) {
    errors.push(`"${name}": no enforcement tokens`);
    continue;
  }
  for (const tok of tokens) {
    const [kind, ...rest] = tok.split(":");
    const arg = rest.join(":").trim();
    switch (kind) {
      case "sast":
        if (!sastRuleIds.has(arg)) {
          errors.push(`"${name}": sast rule not found in ${SAST_PATH}: ${arg}`);
        }
        break;
      case "check":
      case "workflow":
      case "doc":
        if (!arg || !existsSync(join(ROOT, arg))) {
          errors.push(`"${name}": ${kind} path does not exist: ${arg || "(empty)"}`);
        }
        break;
      case "pentest":
        if (!PENTEST_SUITES.has(arg)) {
          errors.push(`"${name}": unknown pentest suite: ${arg}`);
        }
        break;
      case "pgtap": {
        const dir = join(ROOT, PGTAP_DIR);
        if (!existsSync(dir) || !readdirSync(dir).some((f) => f.endsWith(".sql"))) {
          errors.push(`"${name}": pgtap referenced but ${PGTAP_DIR}/ has no suites`);
        }
        break;
      }
      case "config":
      case "n/a":
        if (arg.length < 8) {
          errors.push(`"${name}": ${kind} requires a written justification (got "${arg}")`);
        }
        break;
      default:
        errors.push(`"${name}": unrecognized enforcement token: ${tok}`);
    }
  }
}

// --- Completeness: exactly the 120 canonical sheets, no more, no less. ---------
const canonical = new Set(CANONICAL);
for (const name of CANONICAL) {
  if (!seen.has(name)) errors.push(`MISSING from coverage map: "${name}"`);
}
for (const name of seen.keys()) {
  if (!canonical.has(name)) {
    errors.push(`Unknown cheat sheet in map (not one of the 120): "${name}"`);
  }
}
if (CANONICAL.length !== 120) {
  errors.push(`Canonical list must be 120 sheets; found ${CANONICAL.length}`);
}

// --- Report. ------------------------------------------------------------------
if (errors.length) {
  console.error(`\n❌ OWASP coverage check FAILED (${errors.length} problem(s)):\n`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    `\nEvery one of the 120 OWASP cheat sheets must map to a real enforcement ` +
      `mechanism in ${MAP_PATH}. Fix the map or the referenced control.\n`
  );
  process.exit(1);
}

console.log(
  `✅ OWASP coverage: all ${CANONICAL.length} cheat sheets mapped; ` +
    `${rows.length} rows, ${sastRuleIds.size} SAST rules referenced-and-present.`
);
