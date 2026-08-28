/**
 * Client-side error reporting service.
 *
 * Captures unhandled errors, programmatic reports, React Query failures,
 * service-layer throws, edge function failures, and UI render errors.
 * Writes structured rows to `audit_log` via `write_audit_log` so admins can
 * triage them in /admin/activity-log.
 *
 * Hardening:
 * - Deduplication: identical errors within a 60s window are skipped.
 * - Rate limiting: 10 reports/min/tab; overflow emits a single
 *   `client_error_overflow` per minute carrying the suppressed count.
 * - Payload capping: stack <= 2000 chars, fields <= 100 chars/each.
 * - PII safety: emails, JWTs, and bearer tokens are redacted from the message
 *   (via src/lib/redact) before it lands; only error name/message/stack are kept.
 * - **CRITICAL FIX (May 2026):** previously sent a nil-UUID for `p_user_id`
 *   when no user was known, but `write_audit_log` rejects any non-null
 *   p_user_id != auth.uid(). That made every authenticated client_error
 *   silently fail (6 events/7d). We now pass `null` so the RPC accepts.
 */

import { supabase } from "@/integrations/supabase/client";
import { getCurrentTraceId } from "@/lib/trace";
import { checkNow as checkDeployNow } from "@/lib/deploy-watcher";
import { isChunkLoadMessage } from "@/lib/lazy-with-retry";
import { formatThrowable } from "@/lib/error-normalization";
import { isTransientError } from "@/lib/transient-error";
import { redactText, EMAIL_SOURCE, JWT_SOURCE } from "@/lib/redact";

/**
 * Event types that are infrastructure / observability / aggregate notices.
 * They still write to `audit_log` (admins can see them on /admin/system-health),
 * but they MUST NEVER enter `agent_fix_queue` — they are not actionable code
 * fixes, and surfacing them in Triage drowns out real bugs and wastes AI
 * triage budget. The DB enforces the same rule via
 * `block_non_actionable_fix_queue_inserts` (defense in depth).
 */
const NON_ACTIONABLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  "client_error_overflow",
  "client_error_suppressed",
  "client_error_deduped",
  "external_api_recovered",
  "ui_chunk_load_failed",
  "audit_pressure_changed",
  // User-input validation failures: high-signal UX events for analytics, but
  // never actionable code bugs — bad URL/short password is the user's input,
  // not a regression. Stays in audit_log; blocked from triage queue.
  "validation_rejected",
  // Email queue guardrails + benign lifecycle events: healthy deliverability
  // protections, audited via audit_log + email_send_log + System Health, but
  // never an actionable code defect. Mirrors v_excluded_events in
  // discover_audit_fingerprints and the DB trigger.
  "email_capped",
  "email_dlq",
  "email_reconciled",
  "email_rate_limited",
  "email_frequency_capped",
  "email_suppressed",
  // Transient PG/PostgREST/HTTP infra errors classified at source by
  // isTransientError(). Single source of truth lives in DB function
  // public.is_actionable_event_type — keep this list and that function in
  // sync (CI guard: scripts/ci/check-triage-actionable-parity.mjs).
  "infra_transient",
]);

const MAX_MSG_LENGTH = 2000;
const DEFAULT_CAP_PER_MINUTE = 10;
const DEFAULT_DEDUP_WINDOW_MS = 60_000;
const OVERFLOW_FLUSH_MS = 60_000;
const POLICY_TTL_MS = 5 * 60_000;

interface PolicyEntry {
  capPerMinute: number;
  dedupWindowMs: number;
  minOccurrencesBeforeEscalate: number;
}
type PolicySnapshot = {
  entries: Record<string, PolicyEntry>;
  pressure: "none" | "soft" | "medium" | "hard";
  fetchedAt: number;
};
let policySnapshot: PolicySnapshot = {
  entries: {},
  pressure: "none",
  fetchedAt: 0,
};
let policyInflight: Promise<void> | null = null;

// Per-event-type rate window + dedup
const counters = new Map<string, { count: number; windowStart: number }>();
const recentErrors = new Map<string, number>();
let suppressedSinceLastFlush = 0;
let overflowFlushTimer: ReturnType<typeof setTimeout> | null = null;

// Per-fingerprint rolling counter for the "escalate after N occurrences in
// dedupWindowMs" rule. Keyed by fingerprint, stores recent occurrence
// timestamps; pruned on each touch.
const occurrenceTimeline = new Map<string, number[]>();

function pressureMultiplier(): number {
  switch (policySnapshot.pressure) {
    case "hard":
      return 0.1; // 10% of normal cap
    case "medium":
      return 0.33;
    case "soft":
      return 0.66;
    default:
      return 1;
  }
}

function matchPolicyEntry(eventTypeKey: string): PolicyEntry | undefined {
  // Exact match first, then SQL-style LIKE pattern (% only) so a single
  // policy row can cover all 'client_error::query.announcements.%' fingerprints.
  const exact = policySnapshot.entries[eventTypeKey];
  if (exact) return exact;
  for (const [pattern, entry] of Object.entries(policySnapshot.entries)) {
    if (!pattern.includes("%")) continue;
    const re = new RegExp(
      "^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$"
    );
    if (re.test(eventTypeKey)) return entry;
  }
  return undefined;
}

function getPolicy(eventType: string, fingerprint?: string): PolicyEntry {
  // Try the most specific key first (event_type::fingerprint), then event_type alone.
  const e =
    (fingerprint ? matchPolicyEntry(`${eventType}::${fingerprint}`) : undefined) ??
    matchPolicyEntry(eventType);
  const cap = Math.max(
    1,
    Math.floor((e?.capPerMinute ?? DEFAULT_CAP_PER_MINUTE) * pressureMultiplier())
  );
  const dedup = e?.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS;
  const minOcc = Math.max(1, e?.minOccurrencesBeforeEscalate ?? 1);
  return { capPerMinute: cap, dedupWindowMs: dedup, minOccurrencesBeforeEscalate: minOcc };
}

function recordOccurrenceAndShouldEscalate(
  fp: string,
  windowMs: number,
  minOccurrences: number
): boolean {
  if (minOccurrences <= 1) return true;
  const now = Date.now();
  const cutoff = now - windowMs;
  const arr = (occurrenceTimeline.get(fp) ?? []).filter((t) => t >= cutoff);
  arr.push(now);
  occurrenceTimeline.set(fp, arr);
  // GC if map grows
  if (occurrenceTimeline.size > 500) {
    for (const [k, v] of occurrenceTimeline) {
      if (v.length === 0 || v[v.length - 1] < cutoff) occurrenceTimeline.delete(k);
    }
  }
  return arr.length >= minOccurrences;
}

async function refreshPolicy(): Promise<void> {
  if (Date.now() - policySnapshot.fetchedAt < POLICY_TTL_MS) return;
  if (policyInflight) return policyInflight;
  policyInflight = (async () => {
    try {
      const [{ data: policyRows }, { data: healthRow }] = await Promise.all([
        supabase.rpc("get_audit_policy"),
        supabase.from("system_health_state").select("metadata").eq("id", 1).maybeSingle(),
      ]);
      const entries: Record<string, PolicyEntry> = {};
      if (Array.isArray(policyRows)) {
        for (const row of policyRows as Array<{
          event_type_pattern: string;
          cap_per_minute: number;
          dedup_window_seconds: number;
          min_occurrences_before_escalate?: number;
        }>) {
          entries[row.event_type_pattern] = {
            capPerMinute: row.cap_per_minute,
            dedupWindowMs: row.dedup_window_seconds * 1000,
            minOccurrencesBeforeEscalate: row.min_occurrences_before_escalate ?? 1,
          };
        }
      }
      const meta = (healthRow?.metadata ?? {}) as { audit_pressure?: PolicySnapshot["pressure"] };
      policySnapshot = {
        entries,
        pressure: meta.audit_pressure ?? "none",
        fetchedAt: Date.now(),
      };
    } catch {
      // keep stale snapshot; never throw
      policySnapshot = { ...policySnapshot, fetchedAt: Date.now() };
    } finally {
      policyInflight = null;
    }
  })();
  return policyInflight;
}

export type ReportSeverity = "info" | "warn" | "error";
export type ReportEventType =
  | "client_error"
  | "ui_render_error"
  | "ui_chunk_load_failed"
  | "edge_invoke_failed"
  | "client_error_overflow"
  | "client_error_suppressed"
  | "client_error_deduped"
  | "external_api_recovered"
  | "validation_rejected"
  | "email_capped"
  | "email_dlq"
  | "rpc_failed"
  // Phase-2 triage refactor: typed event_types routed AROUND agent_fix_queue
  // by the DB trigger reject_self_healing_on_agent_fix_queue.
  | "chunk_stale"
  | "query_failed"
  | "mutation_failed"
  // Transient PG/PostgREST/HTTP infra errors. Always non-actionable; never
  // reaches agent_fix_queue (TS NON_ACTIONABLE + DB is_actionable_event_type).
  | "infra_transient";

interface ReportOptions {
  severity?: ReportSeverity;
  eventType?: ReportEventType;
  traceId?: string;
  extraFields?: string[];
  userId?: string;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

/**
 * Collapse dynamic identifiers in a fingerprint key so the same defect seen
 * by N users / N task-lists / N quest-paths produces ONE row in
 * `agent_fix_queue` instead of N. Without this, `source` strings like
 * `query.journey-completed.<uuid>.<phase>.<task,ids,...>` create a fresh
 * fingerprint per occurrence and never dedupe (TRIAGE-NOISE-013).
 *
 * Rules:
 *   - UUIDs → `:id`
 *   - Numeric ids (>=8 digits) → `:id`
 *   - Hex-ish blobs (>=12 chars) → `:hash`
 *   - Comma-separated lists with > 1 token → `:list`
 *   - Trailing dot-segmented task/id slug runs (> 3 dynamic tokens) → `:list`
 */
export function normalizeFingerprintKey(input: string): string {
  if (!input) return input;
  let s = input;
  // PII → placeholder FIRST, so per-user emailed/tokenized messages dedupe to one
  // fingerprint (and no PII lands in agent_fix_queue fingerprints).
  s = s.replace(new RegExp(JWT_SOURCE, "g"), ":jwt");
  s = s.replace(new RegExp(EMAIL_SOURCE, "gi"), ":email");
  // UUID v1-v5
  s = s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
  // Long hex blobs (sha-ish)
  s = s.replace(/\b[0-9a-f]{12,}\b/gi, ":hash");
  // Long numeric ids (timestamps, bigints)
  s = s.replace(/\b\d{8,}\b/g, ":id");
  // Comma-separated slug lists (>= 2 tokens)
  s = s.replace(/([a-z0-9_-]+(?:,[a-z0-9_-]+){1,})/gi, ":list");
  // Trailing dot-separated task/id lists (e.g. obs-1.obs-2.obs-3.obs-4).
  // Preserve stable source prefixes and prior normalized identifiers.
  const parts = s.split(".");
  let dynamicTailStart = parts.length;
  while (
    dynamicTailStart > 2 &&
    /^[a-z0-9_-]+$/i.test(parts[dynamicTailStart - 1] ?? "") &&
    /[-_0-9]/.test(parts[dynamicTailStart - 1] ?? "")
  ) {
    dynamicTailStart -= 1;
  }
  if (parts.length - dynamicTailStart > 3) {
    s = `${parts.slice(0, dynamicTailStart).join(".")}.:list`;
  } else if (parts.length > 5 && parts.slice(-4).every((part) => /^[a-z0-9_-]+$/i.test(part))) {
    s = `${parts.slice(0, -4).join(".")}.:list`;
  }
  return s;
}

function fingerprint(msg: string, source: string): string {
  const normSource = normalizeFingerprintKey(source);
  const normMsg = normalizeFingerprintKey(msg.slice(0, 200));
  return `${normSource}::${normMsg}`;
}

function checkRateLimit(eventType: string, capPerMinute: number): boolean {
  const now = Date.now();
  let bucket = counters.get(eventType);
  if (!bucket || now - bucket.windowStart > 60_000) {
    bucket = { count: 0, windowStart: now };
    counters.set(eventType, bucket);
  }
  if (bucket.count >= capPerMinute) return false;
  bucket.count++;
  return true;
}

function checkDedup(fp: string, dedupWindowMs: number): boolean {
  const now = Date.now();
  const lastSeen = recentErrors.get(fp);
  if (lastSeen && now - lastSeen < dedupWindowMs) {
    recordDedup(fp);
    return false;
  }
  recentErrors.set(fp, now);
  if (recentErrors.size > 200) {
    const cutoff = now - dedupWindowMs;
    for (const [key, ts] of recentErrors) {
      if (ts < cutoff) recentErrors.delete(key);
    }
  }
  return true;
}

function scheduleOverflowFlush() {
  if (overflowFlushTimer) return;
  overflowFlushTimer = setTimeout(() => {
    const count = suppressedSinceLastFlush;
    suppressedSinceLastFlush = 0;
    overflowFlushTimer = null;
    if (count > 0) {
      // Reset the overflow bucket so the overflow notice itself can land.
      counters.delete("client_error_overflow");
      void writeAudit({
        eventType: "client_error_overflow",
        message: `${count} client error report(s) suppressed by rate limit`,
        source: "error-reporter",
        severity: "warn",
        traceId: undefined,
        extraFields: [`suppressed:${count}`, `pressure:${policySnapshot.pressure}`],
        userId: undefined,
      });
    }
  }, OVERFLOW_FLUSH_MS);
}

function buildChangedFields(opts: {
  source: string;
  severity: ReportSeverity;
  traceId?: string;
  extraFields?: string[];
}): string[] {
  const safe = (raw: string) => raw.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 100);
  const fields = [`source:${safe(opts.source)}`, `severity:${opts.severity}`];
  if (opts.traceId) fields.push(`trace:${safe(opts.traceId)}`);
  for (const f of opts.extraFields ?? []) {
    if (f.length <= 100 && /^[A-Za-z0-9_.:-]+$/.test(f)) fields.push(f);
  }
  return fields.slice(0, 50);
}

interface WriteAuditArgs {
  eventType: ReportEventType;
  message: string;
  source: string;
  severity: ReportSeverity;
  traceId?: string;
  extraFields?: string[];
  userId?: string;
}

async function writeAudit(args: WriteAuditArgs): Promise<void> {
  // Redact PII (emails, JWTs, bearer tokens) from the message before it is
  // persisted to audit_log / the fix queue. Fingerprint dedup is handled
  // separately by normalizeFingerprintKey (which also strips these).
  const safeMessage = redactText(args.message);
  try {
    await supabase.rpc("write_audit_log", {
      p_event_type: args.eventType,
      p_table_name: "frontend",
      p_record_id: args.source.slice(0, 200),
      // CRITICAL: pass null when unknown — never a sentinel UUID.
      p_user_id: args.userId ?? null,
      p_error_message: truncate(safeMessage, MAX_MSG_LENGTH),
      p_changed_fields: buildChangedFields({
        source: args.source,
        severity: args.severity,
        traceId: args.traceId,
        extraFields: args.extraFields,
      }),
    });

    // Also feed the error into the triage queue (admin-only triage UI reads this).
    // Best-effort: failure here must never throw. Skip pure overflow events,
    // but include `warn` severity so validation_rejected and aggregate
    // suppressed/deduped notices reach admins.
    // Triage queue is reserved for actionable, severity=error code bugs.
    // Skip aggregate observability notices, infra events, and any non-error
    // severity. The DB trigger `block_non_actionable_fix_queue_inserts`
    // enforces the same rule belt-and-suspenders.
    const skipQueue = args.severity !== "error" || NON_ACTIONABLE_EVENT_TYPES.has(args.eventType);
    if (!skipQueue) {
      const fp = `${args.eventType}::${fingerprint(args.message, args.source)}`;
      await supabase.rpc("upsert_fix_queue_entry", {
        p_fingerprint: fp,
        p_event_type: args.eventType,
        p_source: args.source.slice(0, 200),
        p_error_message: truncate(safeMessage, MAX_MSG_LENGTH),
        p_severity: args.severity,
        p_sample_trace_id: args.traceId ?? null,
      });
    }
  } catch {
    // Telemetry must never throw.
  }
}

async function reportToAuditLog(errorMessage: string, source: string, options: ReportOptions = {}) {
  // Opaque cross-origin "Script error." carries no actionable detail. Drop
  // FIRST so it never reaches audit_log (where discover_audit_fingerprints
  // would re-promote it into the Triage queue).
  if (isOpaqueScriptErrorMessage(errorMessage)) return;
  // Universal suppression — applies to every reporter path, not just the
  // global window handlers. This closes the bypass that previously let
  // direct callers (e.g. service-layer catches) skip the SUPPRESSED_PATTERNS
  // list and flood `audit_log` with known-noise events.
  if (isSuppressed(errorMessage) || isSuppressed(source)) return;
  // Best-effort policy refresh; never blocks first call (uses stale snapshot).
  void refreshPolicy();
  const eventType = options.eventType ?? "client_error";
  const fp = `${eventType}::${fingerprint(errorMessage, source)}`;
  const policy = getPolicy(eventType, fingerprint(errorMessage, source));
  if (!checkDedup(fp, policy.dedupWindowMs)) return;
  if (!checkRateLimit(eventType, policy.capPerMinute)) {
    suppressedSinceLastFlush += 1;
    scheduleOverflowFlush();
    return;
  }
  // Escalate-after-N: when policy requires multiple occurrences in the dedup
  // window before triage, count this hit but skip writing until the threshold
  // is reached. The aggregate suppression flush still records the drops so
  // admins have visibility in /admin/system-health.
  if (
    !recordOccurrenceAndShouldEscalate(
      fp,
      policy.dedupWindowMs,
      policy.minOccurrencesBeforeEscalate
    )
  ) {
    recordDedup(fp);
    return;
  }

  await writeAudit({
    eventType,
    message: errorMessage,
    source,
    severity: options.severity ?? "error",
    traceId: options.traceId ?? getCurrentTraceId(),
    extraFields: options.extraFields,
    userId: options.userId,
  });
}

/**
 * Report a caught error programmatically.
 *
 * ```ts
 * try { ... } catch (e) { reportError(e, "MyComponent.handleClick"); }
 * ```
 */
export function reportError(
  err: unknown,
  source = "unknown",
  optionsOrUserId: ReportOptions | string = {}
) {
  // Structural ZodError drop — covers thrown ZodError instances whose
  // toString() doesn't include the literal "ZodError: [..." payload that
  // `handleZodErrorMessage` regex-matches below. These are form-validation
  // rejections that the form UI already surfaces to the user; they are not
  // ops-level errors and must never reach `agent_fix_queue` or the daily
  // digest. Aggregate count is still flushed via the suppression counter.
  if (err && typeof err === "object") {
    const e = err as { name?: unknown; issues?: unknown };
    const looksLikeZod = e.name === "ZodError" || (Array.isArray(e.issues) && e.issues.length > 0);
    if (looksLikeZod) {
      recordSuppression("__zod_structural__");
      return;
    }
  }
  const msg = formatThrowable(err);
  if (isOpaqueScriptErrorMessage(msg)) return;
  if (isSuppressed(msg)) return;
  if (handleZodErrorMessage(msg, source)) return;
  const options: ReportOptions =
    typeof optionsOrUserId === "string" ? { userId: optionsOrUserId } : { ...optionsOrUserId };

  // Transient PG/PostgREST/HTTP infra errors — classified at source and
  // routed to event_type=infra_transient severity=info. This is the single
  // chokepoint that keeps PGRST002, 57014, 53300, 429s, etc. out of the
  // admin Triage queue regardless of which service raised them.
  // Mirrors public.is_actionable_event_type() in the database (CI guard:
  // scripts/ci/check-triage-actionable-parity.mjs).
  if (isTransientError(err)) {
    options.eventType = "infra_transient";
    options.severity = "info";
  }

  // Tag Postgres "column reference ... is ambiguous" errors with a stable
  // fingerprint keyed by the offending function so regressions of the
  // plpgsql OUT-param shadowing class group instantly in Triage.
  const ambiguous = /column reference "([^"]+)" is ambiguous/i.exec(msg);
  if (ambiguous) {
    const col = ambiguous[1];
    const fnMatch =
      /\b(get_[a-z0-9_]+|[a-z0-9_]+_(?:summary|dashboard|status|distribution|fingerprints))\b/i.exec(
        `${source} ${msg}`
      );
    const fn = fnMatch ? fnMatch[1] : "unknown_fn";
    options.extraFields = [
      ...(options.extraFields ?? []),
      `fingerprint:pg.column_ambiguous:${fn}:${col}`,
      `pg_error:column_ambiguous`,
    ];
    options.severity = "error";
    // Ambiguity is a real code bug — never silently downgrade to infra_transient.
    options.eventType = "client_error";
  }
  void reportToAuditLog(msg, source, options);
}

/**
 * Classify a leaked ZodError (e.g. from react-hook-form's async resolver
 * surfacing as an unhandledrejection). Required-field / type rejections are
 * normal UX and dropped silently with an aggregate suppression counter;
 * regex/refine failures route to `validation_rejected` (warn) so admins can
 * still spot false-positive validators. Returns true if handled.
 */
function handleZodErrorMessage(msg: string, source: string): boolean {
  const m = /ZodError:\s*(\[[\s\S]*\])/.exec(msg);
  if (!m) return false;
  let issues: Array<{ path?: PropertyKey[]; message?: string; code?: string }> = [];
  try {
    const parsed = JSON.parse(m[1]);
    if (Array.isArray(parsed)) issues = parsed;
  } catch {
    // Truncated/non-JSON payload — treat as silent UX rejection.
    recordSuppression("__zod_unparseable__");
    return true;
  }
  if (issues.length === 0) {
    recordSuppression("__zod_empty__");
    return true;
  }
  const REQUIRED_RX = /required|cannot be empty|must not be empty/i;
  const meaningful = issues.filter((i) => {
    const code = String(i?.code ?? "");
    if (code === "too_small" || code === "invalid_type") return false;
    if (i?.message && REQUIRED_RX.test(i.message)) return false;
    return true;
  });
  if (meaningful.length === 0) {
    recordSuppression("__zod_required__");
    return true;
  }
  reportValidationRejection(
    "unhandled-zod",
    meaningful.map((i) => ({
      path: (i.path ?? []) as PropertyKey[],
      message: String(i.message ?? "validation failed"),
      code: i.code,
    })),
    source
  );
  return true;
}

/**
 * Report a non-error activity (e.g. session_idle_timeout, push_permission_denied)
 * that should land in the audit log. Severity defaults to "info".
 */
export function reportActivity(
  eventType: ReportEventType,
  source: string,
  message: string,
  options: Omit<ReportOptions, "eventType"> = {}
) {
  void reportToAuditLog(message, source, {
    ...options,
    eventType,
    severity: options.severity ?? "info",
  });
}

/**
 * Lane 2 self-heal ledger event: emitted by retry wrappers / CircuitBreaker
 * when a previously failing dependency starts succeeding again.
 *
 * Heavily rate-limited (the audit policy caps `external_api_recovered` to a
 * few per minute per source) so a flapping dependency cannot spam the log.
 *
 * @example breaker recovery
 *   reportRecovery("Discord", { attempts: 4 });
 */
export function reportRecovery(
  source: string,
  detail: { attempts?: number; durationMs?: number } = {}
) {
  const extras: string[] = [];
  if (typeof detail.attempts === "number") extras.push(`attempts:${detail.attempts}`);
  if (typeof detail.durationMs === "number")
    extras.push(`durationMs:${Math.min(detail.durationMs, 999_999)}`);
  void reportToAuditLog(`${source} recovered after transient failure`, source, {
    eventType: "external_api_recovered",
    severity: "info",
    extraFields: extras,
  });
}

const SUPPRESSED_PATTERNS = [
  "Lock broken by another request",
  "Lock was stolen by another request",
  "newestWorker is null",
  "Failed to update a ServiceWorker",
  "An unknown error occurred when fetching the script",
  "Extension context invalidated",
  "Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script",
  "at predicate (eval at evaluate",
  "ResizeObserver loop completed with undelivered notifications",
  "ResizeObserver loop limit exceeded",
  // --- Browser-extension noise (MetaMask, Firefox reader, Chrome WebView, TransOver, etc.) ---
  "Failed to connect to MetaMask",
  "window.ethereum",
  "__firefox__",
  "__gCrWeb",
  "transover-popup",
  "transover-type-and-translate-popup",
  "chrome-extension://",
  "moz-extension://",
  "safari-web-extension://",
  // --- Optional / transient edge-function transport failures ---
  // Thrown by supabase-js when the network call itself fails (offline, DNS,
  // CORS preflight aborted, optional service not configured -> 503). These
  // are not actionable as code fixes — they're either user-network issues or
  // intentionally unconfigured optional services. Surfacing them in triage
  // drowns out real bugs.
  "FunctionsFetchError",
  "Failed to send a request to the Edge Function",
  // Bare network failure from fetch() — same story.
  "TypeError: Failed to fetch",
  "TypeError: NetworkError when attempting to fetch resource",
  "TypeError: Load failed",
  // --- Request cancellations ---
  // AbortError fires when a fetch / React Query is cancelled mid-flight
  // (component unmount, query key change, route change). Expected behavior;
  // not actionable. Was the #1 noise source (133 events in 19min, May 2026).
  "AbortError",
  "The operation was aborted",
  "signal is aborted without reason",
  // (Removed earlier blanket "ZodError" suppression — it was masking real
  // false-positive validator rejections. Surface them so triage can see them.)
  // --- Third-party consent banner (CookieYes) noise ---
  // CookieYes script (loaded by published-site wrapper, not our code) logs a
  // loud Error when the registered site URL on its dashboard doesn't match the
  // current host (preview vs custom domain vs published). Not actionable in
  // our codebase. Was flooding the fix queue with hundreds of events.
  "cdn-cookieyes.com",
  "cookieyes.com/support",
  "Looks like your website URL has changed",
  // (Removed 2026-05-30: "Not authorized for project", "code=42501",
  // "Push notifications are not ready", "service worker is unavailable",
  // "Recipient already received", "TTL exceeded", "use-autosave", "Script error."
  // — these were band-aid substring filters; root causes are now refactored.
  // See mem://features/triage-noise-suppression and TRIAGE-FIX-00{1..7}.)
] as const;

// Suppress empty unhandledrejection payloads ("{}") — almost always extension noise
// or aborted fetches with no actionable content.
function isEmptyRejection(msg: string): boolean {
  const trimmed = msg.trim();
  return trimmed === "{}" || trimmed === "" || trimmed === "null" || trimmed === "undefined";
}

export function isOpaqueScriptErrorMessage(msg: string): boolean {
  // Browsers emit the literal string "Script error." (sometimes without the
  // trailing period, sometimes wrapped as "Error: Script error.") when a
  // cross-origin script throws and CORS hides the real details. React's
  // synthetic dispatchEvent path can also wrap the payload with a synthesized
  // stack trace, so the message may be MULTI-LINE — we must only inspect the
  // first non-empty line.
  //
  // Also covers React Query's `SerializationError: Non-Error thrown: {...}`
  // wrapper when the thrown value carries no message — by definition no
  // actionable stack/file/message (TRIAGE-NOISE-014).
  //
  // Drop unconditionally at every reporter entrypoint.
  const firstLine =
    (msg ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  if (/^(error:\s*)?script error\.?$/i.test(firstLine)) return true;
  // SerializationError with empty payload / empty message — opaque by design.
  if (
    /^SerializationError:\s*Non-Error thrown:\s*\{?\s*"?message"?\s*:\s*""\s*\}?\s*$/i.test(
      firstLine
    )
  )
    return true;
  if (/^SerializationError:\s*Non-Error thrown:\s*\{\s*\}?\s*$/i.test(firstLine)) return true;
  return false;
}

// Back-compat wrapper for the window.onerror caller (uses ErrorEvent shape).
function isOpaqueScriptError(_event: ErrorEvent, msg: string): boolean {
  return isOpaqueScriptErrorMessage(msg);
}

// --- Aggregate observability for silent drops ------------------------
// We never want suppression / dedup to be a black hole. Once a minute we
// emit a single audit row summarizing what got dropped, so admins can spot
// regressions (e.g. a new browser extension flooding noise) in System Health.
const suppressedCounts = new Map<string, number>();
const dedupCounts = new Map<string, number>();
let suppressionFlushTimer: ReturnType<typeof setTimeout> | null = null;
const SUPPRESSION_FLUSH_MS = 60_000;

function scheduleSuppressionFlush() {
  if (suppressionFlushTimer) return;
  suppressionFlushTimer = setTimeout(() => {
    suppressionFlushTimer = null;
    const supEntries = [...suppressedCounts.entries()];
    const dedupEntries = [...dedupCounts.entries()];
    suppressedCounts.clear();
    dedupCounts.clear();
    for (const [pattern, count] of supEntries) {
      if (count <= 0) continue;
      void writeAudit({
        eventType: "client_error_suppressed",
        message: `${count} client error(s) suppressed by pattern "${pattern}"`,
        source: "error-reporter.suppression",
        severity: "warn",
        traceId: undefined,
        extraFields: [
          `pattern:${pattern.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 60)}`,
          `count:${count}`,
        ],
        userId: undefined,
      });
    }
    for (const [fp, count] of dedupEntries) {
      if (count <= 1) continue; // first hit wasn't a drop
      void writeAudit({
        eventType: "client_error_deduped",
        message: `${count - 1} duplicate client error(s) deduped`,
        source: fp.split("::")[1] ?? "unknown",
        severity: "warn",
        traceId: undefined,
        extraFields: [
          `fingerprint:${fp.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80)}`,
          `count:${count}`,
        ],
        userId: undefined,
      });
    }
  }, SUPPRESSION_FLUSH_MS);
}

function recordSuppression(pattern: string) {
  suppressedCounts.set(pattern, (suppressedCounts.get(pattern) ?? 0) + 1);
  scheduleSuppressionFlush();
}

function recordDedup(fp: string) {
  dedupCounts.set(fp, (dedupCounts.get(fp) ?? 0) + 1);
  scheduleSuppressionFlush();
}

export function isSuppressed(msg: string): boolean {
  if (isEmptyRejection(msg)) {
    recordSuppression("__empty_rejection__");
    return true;
  }
  for (const p of SUPPRESSED_PATTERNS) {
    if (msg.includes(p)) {
      recordSuppression(p.slice(0, 60));
      // Stale-bundle nudge: a FunctionsFetchError from a removed component is
      // a high-confidence stale-tab signal. Trigger an out-of-band version
      // check so a stuck tab reloads on the next idle window instead of
      // firing dozens of retries. Throttled inside checkDeployNow.
      if (p === "FunctionsFetchError") {
        try {
          checkDeployNow();
        } catch {
          /* never throw from telemetry */
        }
      }
      return true;
    }
  }
  return false;
}

/**
 * Report a Zod (or any) validation rejection so admins can spot false-positive
 * regex patterns that are silently blocking legitimate user input.
 *
 * Severity is `warn` (not `error`) — these aren't crashes, but they ARE
 * high-signal UX bugs we always want to see in triage.
 *
 * @example
 *   const result = profileSchema.safeParse(input);
 *   if (!result.success) {
 *     reportValidationRejection("profileSchema", result.error.issues, "ProfileSetupPage.handleSubmit");
 *   }
 */
export function reportValidationRejection(
  schemaName: string,
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string; code?: string }>,
  source: string,
  options: Omit<ReportOptions, "eventType" | "severity"> = {}
) {
  if (!issues || issues.length === 0) return;
  // Filter out "user just forgot to fill a required field" rejections — those are
  // normal UX, not regex/schema bugs. We only want to surface high-signal issues
  // (format/regex/refine failures on non-empty input) so admin triage stays useful.
  const REQUIRED_PATTERN = /required|cannot be empty|must not be empty|too_small|invalid_type/i;
  const meaningful = issues.filter((i) => {
    const code = String(i.code ?? "");
    if (code === "too_small" || code === "invalid_type") return false;
    if (REQUIRED_PATTERN.test(i.message)) return false;
    return true;
  });
  if (meaningful.length === 0) return;
  const first = meaningful[0];
  const fieldPath = first.path.map(String).join(".") || "(root)";
  const code = first.code ?? "validation";
  // Compact message lists every offending field so admins can see scope.
  const fields = meaningful
    .slice(0, 8)
    .map((i) => {
      const f = i.path.map(String).join(".") || "(root)";
      return `${f}: ${i.message}`;
    })
    .join(" | ");
  const message = `[${schemaName}] ${fields}`;
  void reportToAuditLog(message, source, {
    ...options,
    eventType: "validation_rejected",
    severity: "warn",
    extraFields: [
      `schema:${schemaName.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 60)}`,
      `field:${fieldPath.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 60)}`,
      `code:${String(code)
        .replace(/[^A-Za-z0-9_.:-]/g, "_")
        .slice(0, 40)}`,
      `count:${meaningful.length}`,
      ...(options.extraFields ?? []),
    ],
  });
}

/**
 * Stale-bundle chunk-load failures can surface via window.onerror /
 * unhandledrejection BEFORE React's ErrorBoundary catches them (e.g. when a
 * Suspense lazy import rejects). Without classification they would land as
 * `client_error severity=error` and flood Triage. Route them to the dedicated
 * `ui_chunk_load_failed` event_type at severity `warn` so they stay in
 * `audit_log` for observability but are blocked from `agent_fix_queue`.
 */
function chunkAwareReport(msg: string, source: string) {
  if (handleZodErrorMessage(msg, source)) return;
  if (isChunkLoadMessage(msg)) {
    void reportToAuditLog(msg, source, {
      eventType: "ui_chunk_load_failed",
      severity: "warn",
    });
    return;
  }
  void reportToAuditLog(msg, source);
}

export function installGlobalErrorReporter() {
  window.addEventListener("error", (event) => {
    const msg = formatThrowable(event.error ?? event.message);
    if (isOpaqueScriptError(event, msg)) return;
    if (isSuppressed(msg)) return;
    // Suppress errors whose source is a browser extension URL.
    if (event.filename && /^(chrome|moz|safari-web)-extension:\/\//.test(event.filename)) return;
    const source = event.filename
      ? `${event.filename}:${event.lineno}:${event.colno}`
      : "window.onerror";
    chunkAwareReport(msg, source);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const msg = formatThrowable(event.reason);
    if (isOpaqueScriptErrorMessage(msg)) return;
    if (isSuppressed(msg)) return;
    chunkAwareReport(msg, "unhandledrejection");
  });
}
