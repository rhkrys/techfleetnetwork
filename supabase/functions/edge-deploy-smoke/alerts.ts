// Audit H14 — the "function silently un-deployed" alert.
//
// The previous implementation inserted directly into `audit_log` using columns
// that DO NOT EXIST (action / resource_type / resource_id / metadata, and an
// object `changed_fields` where the column is `text[]`). PostgREST rejected it,
// the error was never checked, and the silent-deploy alarm was itself silent —
// exactly the "function removed and nobody noticed" incident class it exists to
// catch. Worse, `notify-critical-fix` (the pager) never reads `audit_log`; it
// scans `agent_fix_queue` for `severity='error'` fingerprints.
//
// The canonical path is `auditEdgeEvent` (../_shared/audit.ts): it writes a
// `write_audit_log` row whose `changed_fields` text[] carries the `severity:error`
// tag, which the triage promotion lifts into `agent_fix_queue` — the table the
// pager actually scans. This module builds the event args for one not-deployed
// function, kept separate from index.ts so it is unit-testable without starting
// the Deno.serve listener.
import type { AuditEdgeEventArgs } from "../_shared/audit.ts";

/** Build the severity:error audit event for a single un-deployed function. */
export function buildNotDeployedAuditEvent(name: string): AuditEdgeEventArgs {
  return {
    fn: "edge-deploy-smoke",
    event: "edge_function_not_deployed",
    table: "edge_function",
    recordId: name,
    severity: "error",
    // Per-function tag so distinct outages fingerprint (and page) separately.
    // Must match auditEdgeEvent's allowed tag charset /^[A-Za-z0-9_.:-]+$/.
    fields: [`fn:${name}`.slice(0, 100)],
    errorMessage: `Edge function ${name} returned 404 (not deployed)`,
  };
}
