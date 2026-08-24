// Email Octopus API v2 client (server-side only). ADR-0017: EO is the marketing source of truth.
// The API key never reaches the browser. Pure and injectable (fetch is passed in) so it is
// unit/contract-testable without a network.
//
// Contract (https://emailoctopus.com/api-documentation/v2):
//   Base: https://api.emailoctopus.com     Auth: Authorization: Bearer <api key>
//   Upsert (subscribe OR unsubscribe): PUT /lists/{listId}/contacts
//     body { email_address, status, fields? } — keyed by email, so no contact id is needed for either.
//   Delete: DELETE /lists/{listId}/contacts/{contactId}, contactId = md5(lowercased email).
//   Rate limit: token bucket (100, +10/s) -> HTTP 429. Errors: RFC 7807 JSON { detail, title, ... }.
import { createHash } from "node:crypto";

export type EoDesiredStatus = "subscribed" | "unsubscribed" | "deleted";
export type EoOutcome = "synced" | "retry" | "permanent_fail";

export interface EoResult {
  outcome: EoOutcome;
  statusCode: number | null;
  error: string | null;
}

export interface EoConfig {
  apiKey: string;
  listId: string;
  baseUrl?: string; // default https://api.emailoctopus.com
  firstNameField?: string | null; // EO field tag for first name; unset => send no custom fields
  doubleOptIn?: boolean; // list has double opt-in => subscribe is sent as "pending" (EO confirms)
  fetchImpl?: typeof fetch; // injectable for tests
}

export interface EoPushInput {
  email: string;
  desiredStatus: EoDesiredStatus;
  fields?: Record<string, unknown>;
}

const DEFAULT_BASE = "https://api.emailoctopus.com";

/**
 * EO contact id: md5 of the lowercased, trimmed email. This md5 is a NON-cryptographic third-party
 * PROTOCOL identifier mandated by the Email Octopus API v2 (a contact is addressed as
 * md5(lowercased email)); it is not a security/integrity hash and has no SHA-256 alternative EO
 * accepts. The SAST weak-hash rule scopes its one allowed exception to exactly this file.
 */
export function contactId(email: string): string {
  return createHash("md5").update(email.trim().toLowerCase()).digest("hex");
}

/**
 * Load the EO config from the environment. Returns null when the secrets are absent — that IS the
 * feature flag (sync fails closed / stays disabled without EMAILOCTOPUS_API_KEY + _LIST_ID).
 */
export function eoConfigFromEnv(env: { get(k: string): string | undefined }): EoConfig | null {
  const apiKey = env.get("EMAILOCTOPUS_API_KEY");
  const listId = env.get("EMAILOCTOPUS_LIST_ID");
  if (!apiKey || !listId) return null;
  return {
    apiKey,
    listId,
    firstNameField: env.get("EMAILOCTOPUS_FIRSTNAME_FIELD") ?? null,
    // Set EMAILOCTOPUS_DOUBLE_OPT_IN=true when the EO list has double opt-in enabled — subscribes are
    // then sent as "pending" so EO emails the confirmation link instead of returning "Bad request."
    doubleOptIn: env.get("EMAILOCTOPUS_DOUBLE_OPT_IN") === "true",
  };
}

/**
 * Push one contact's desired state to EO. Returns a normalized outcome the worker feeds straight to
 * record_eo_sync_result. Idempotent: re-running the same push is safe (upsert / delete-then-404).
 */
export async function pushDesiredState(cfg: EoConfig, input: EoPushInput): Promise<EoResult> {
  const base = (cfg.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
  const doFetch = cfg.fetchImpl ?? fetch;
  const email = input.email.trim().toLowerCase();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
  };
  const list = encodeURIComponent(cfg.listId);

  let res: Response;
  try {
    if (input.desiredStatus === "deleted") {
      res = await doFetch(`${base}/lists/${list}/contacts/${contactId(email)}`, {
        method: "DELETE",
        headers,
      });
    } else {
      const body: Record<string, unknown> = {
        email_address: email,
        // On a DOUBLE opt-in list, EO rejects a direct "subscribed" via the API ("Bad request"); it
        // must be created as "pending" so EO sends its confirmation email (the member confirms → EO
        // marks them subscribed). On a single opt-in list we set "subscribed" directly. Unsubscribe
        // is always "unsubscribed" regardless.
        status:
          input.desiredStatus === "subscribed" && cfg.doubleOptIn ? "pending" : input.desiredStatus,
      };
      // Only send custom fields when a field tag is configured — a list without that tag returns 422,
      // which would loop to DLQ forever. Personalization is optional; the subscription is not.
      if (cfg.firstNameField && input.fields && input.fields.first_name) {
        body.fields = { [cfg.firstNameField]: input.fields.first_name };
      }
      res = await doFetch(`${base}/lists/${list}/contacts`, {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      });
    }
  } catch (e) {
    // Network / DNS / timeout — transient, so retry (never lose an opt-out).
    const msg = e instanceof Error ? e.message : String(e);
    return { outcome: "retry", statusCode: null, error: `network: ${msg}` };
  }

  return await classify(res, input.desiredStatus);
}

export type EoContactStatus = "subscribed" | "unsubscribed" | "pending" | "not_found" | "unknown";

/**
 * Live read of ONE contact's current status from EO (the source of truth), for display. Used to show
 * a member's true subscription state even when they subscribed/unsubscribed outside the platform.
 * Never throws: any error (network / non-2xx / bad body) maps to "unknown" so the caller can fall back
 * to the cached mirror. 404 = the contact is not on the list ("not_found").
 */
export async function fetchContactStatus(
  cfg: EoConfig,
  email: string
): Promise<{ status: EoContactStatus; statusCode: number | null }> {
  const base = (cfg.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
  const doFetch = cfg.fetchImpl ?? fetch;
  const normalized = email.trim().toLowerCase();
  let res: Response;
  try {
    res = await doFetch(
      `${base}/lists/${encodeURIComponent(cfg.listId)}/contacts/${contactId(normalized)}`,
      { method: "GET", headers: { Authorization: `Bearer ${cfg.apiKey}` } }
    );
  } catch {
    return { status: "unknown", statusCode: null };
  }
  if (res.status === 404) return { status: "not_found", statusCode: 404 };
  if (res.status < 200 || res.status >= 300) return { status: "unknown", statusCode: res.status };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { status: "unknown", statusCode: res.status };
  }
  const s = String((body as { status?: unknown })?.status ?? "").toLowerCase();
  if (s === "subscribed" || s === "unsubscribed" || s === "pending") {
    return { status: s as EoContactStatus, statusCode: res.status };
  }
  return { status: "unknown", statusCode: res.status };
}

async function classify(res: Response, desired: EoDesiredStatus): Promise<EoResult> {
  const code = res.status;
  if (code >= 200 && code < 300) {
    return { outcome: "synced", statusCode: code, error: null };
  }
  // Idempotent success: deleting a contact EO no longer has is already the desired end state.
  if (code === 404 && desired === "deleted") {
    return { outcome: "synced", statusCode: code, error: null };
  }

  const detail = await safeDetail(res);

  // Transient / recoverable: rate limit, timeout, server error, and auth/permission (usually a
  // key or list-id that has not been fixed YET — keep retrying rather than dropping the intent).
  if (code === 429 || code === 408 || code >= 500 || code === 401 || code === 403) {
    return { outcome: "retry", statusCode: code, error: detail };
  }
  // 400 / 409 / 422 and other 4xx: the request is bad for this contact. Permanent — goes to the DLQ,
  // which is replayable once the data is fixed.
  return { outcome: "permanent_fail", statusCode: code, error: detail };
}

async function safeDetail(res: Response): Promise<string> {
  try {
    const j = await res.json();
    const d = j?.detail ?? j?.title ?? JSON.stringify(j);
    return String(d).slice(0, 500);
  } catch {
    return `HTTP ${res.status}`;
  }
}
