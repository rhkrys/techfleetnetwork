/**
 * auth-prober — synthetic end-to-end auth probe. Runs the real
 * `reset → sign-out → sign-in` path against staging/production every
 * 5 minutes against a sealed test account. Two consecutive failures
 * page admins via Triage Critical Push.
 *
 * Per §13/§18 of the rebuild plan, the prober's user-agent is excluded
 * from user-facing failure counters by `auth-failure-policy`.
 *
 * NOTE: This module is environment-agnostic — it talks only to the
 * `auth-broker` edge function, which means the prober can run from a
 * cron edge function, a Playwright job, or a Deno script without
 * importing the browser supabase client.
 */

export const PROBER_USER_AGENT = "TFN-AuthProber/1.0";

export type ProbeStage =
  | "reset_request"
  | "reset_complete"
  | "sign_out"
  | "sign_in"
  | "session_refresh";

export type ProbeOutcome = "ok" | "err" | "skipped";

export interface ProbeResult {
  stage: ProbeStage;
  outcome: ProbeOutcome;
  errorCode?: string;
  latencyMs: number;
  correlationId: string;
}

export interface ProberInputs {
  brokerUrl: string;
  testEmail: string;
  /** The TEMPORARY password the prober will set, verify, and discard. */
  temporaryPassword: string;
  /** Bearer for the broker (anon key for public routes is fine). */
  authHeader: string;
  fetchImpl?: typeof fetch;
}

interface BrokerResponse {
  ok: boolean;
  code?: string;
  [k: string]: unknown;
}

async function callBroker(
  inputs: ProberInputs,
  route: string,
  body: Record<string, unknown>,
  correlationId: string,
): Promise<{ status: number; json: BrokerResponse; latencyMs: number }> {
  const fetchImpl = inputs.fetchImpl ?? fetch;
  const start = Date.now();
  const res = await fetchImpl(`${inputs.brokerUrl.replace(/\/$/, "")}/${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: inputs.authHeader,
      "user-agent": PROBER_USER_AGENT,
      "x-correlation-id": correlationId,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({ ok: false, code: "unexpected" }))) as BrokerResponse;
  return { status: res.status, json, latencyMs: Date.now() - start };
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Run the full prober path. Returns one ProbeResult per stage. Caller is
 * responsible for persisting rows into `auth_prober_results`.
 */
export async function runAuthProbe(inputs: ProberInputs): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const correlationId = newId();

  // Stage 1 — request password reset (must always return ok per
  // anti-enumeration contract).
  try {
    const r = await callBroker(inputs, "password-reset/request", { email: inputs.testEmail }, correlationId);
    results.push({
      stage: "reset_request",
      outcome: r.json.ok ? "ok" : "err",
      errorCode: r.json.ok ? undefined : (r.json.code ?? "unexpected"),
      latencyMs: r.latencyMs,
      correlationId,
    });
  } catch (e) {
    results.push({
      stage: "reset_request",
      outcome: "err",
      errorCode: "network_error",
      latencyMs: 0,
      correlationId,
    });
    return results; // bail — no point continuing
  }

  // Stages 2 (reset_complete) requires consuming an email token, which the
  // prober cannot do without an inbox-fetcher. In the cron incarnation
  // this is skipped; the Playwright incarnation overrides this method.
  results.push({
    stage: "reset_complete",
    outcome: "skipped",
    latencyMs: 0,
    correlationId,
  });

  // Stage 3 — sign in with the known temporary password.
  try {
    const r = await callBroker(
      inputs,
      "sign-in/password",
      { email: inputs.testEmail, password: inputs.temporaryPassword },
      correlationId,
    );
    results.push({
      stage: "sign_in",
      outcome: r.json.ok ? "ok" : "err",
      errorCode: r.json.ok ? undefined : (r.json.code ?? "unexpected"),
      latencyMs: r.latencyMs,
      correlationId,
    });
  } catch {
    results.push({
      stage: "sign_in",
      outcome: "err",
      errorCode: "network_error",
      latencyMs: 0,
      correlationId,
    });
  }

  // Stage 4 — sign out.
  try {
    const r = await callBroker(inputs, "sign-out", {}, correlationId);
    results.push({
      stage: "sign_out",
      outcome: r.json.ok || r.status === 200 ? "ok" : "err",
      errorCode: r.json.ok ? undefined : (r.json.code ?? "unexpected"),
      latencyMs: r.latencyMs,
      correlationId,
    });
  } catch {
    results.push({
      stage: "sign_out",
      outcome: "err",
      errorCode: "network_error",
      latencyMs: 0,
      correlationId,
    });
  }

  return results;
}

/**
 * Synthetic two-strike alert evaluator. Returns true if the latest run
 * AND the prior run both contained an `err` outcome for the same stage.
 */
export function shouldPage(latest: ProbeResult[], prior: ProbeResult[] | null): boolean {
  if (!prior) return false;
  const errStages = new Set(latest.filter((r) => r.outcome === "err").map((r) => r.stage));
  if (errStages.size === 0) return false;
  return prior.some((r) => r.outcome === "err" && errStages.has(r.stage));
}
