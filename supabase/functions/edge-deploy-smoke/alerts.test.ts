// Module: supabase/functions/edge-deploy-smoke (bdd-gate D-13 coverage marker)
// Audit H14 regression — the silent-deploy alarm must emit a severity:error
// event through the canonical pipeline (auditEdgeEvent -> write_audit_log ->
// agent_fix_queue), NOT a raw audit_log insert with non-existent columns.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildNotDeployedAuditEvent } from "./alerts.ts";

Deno.test("H14: not-deployed event is severity:error on the audit pipeline", () => {
  const e = buildNotDeployedAuditEvent("process-email-queue");
  assertEquals(e.severity, "error"); // promoted to agent_fix_queue -> pages
  assertEquals(e.event, "edge_function_not_deployed");
  assertEquals(e.recordId, "process-email-queue");
  assert(e.errorMessage!.includes("process-email-queue"));
});

Deno.test("H14: distinct functions produce distinct, well-formed fingerprintable events", () => {
  const a = buildNotDeployedAuditEvent("email-dispatcher");
  const b = buildNotDeployedAuditEvent("gumroad-webhook");
  // Per-function recordId + errorMessage so the triage fingerprint (and paging)
  // separates one outage from another instead of collapsing them.
  assert(a.recordId !== b.recordId);
  assert(a.errorMessage !== b.errorMessage);
});

Deno.test("H14: audit tags satisfy auditEdgeEvent's allowed charset", () => {
  // auditEdgeEvent drops any field not matching /^[A-Za-z0-9_.:-]+$/ (len<=100);
  // a malformed tag would silently vanish, so assert every tag survives.
  const e = buildNotDeployedAuditEvent("refresh-community-events");
  for (const f of e.fields ?? []) {
    assert(f.length <= 100, `tag too long: ${f}`);
    assert(/^[A-Za-z0-9_.:-]+$/.test(f), `tag has illegal chars: ${f}`);
  }
});
