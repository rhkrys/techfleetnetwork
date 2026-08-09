// Server-side support-ticket creation, keyed on a linked Discord user id.
//
// discord-interactions is signature-authenticated (no Supabase JWT), so it can't
// call the JWT-gated freescout-proxy. This helper mirrors the proxy `create`
// action exactly — ensure a Freescout customer for the resolved member, open a
// conversation, and eagerly record the pointer so the ticket shows in the
// member's "My tickets" + the admin grid — but resolves the member by
// profiles.discord_user_id instead of an auth token.
//
// Imports _shared/freescout.ts, which throws at module load if FREESCOUT_API_KEY
// is unset. Callers should import THIS module lazily (dynamic import) so that
// tripwire only fires on the /support path, never on unrelated interactions.
import { getAdminClient } from "./admin-client.ts";
import { auditEdgeEvent } from "./audit.ts";
import {
  freescoutFetch,
  findCustomerByEmail,
  createCustomer,
  DEFAULT_MAILBOX_ID,
} from "./freescout.ts";

/** Per-member cap on Discord-created tickets per rolling hour (abuse/DoS guard,
 *  parity with the web create path's support_check_rate_limit of 10/hr). */
const RATE_LIMIT_PER_HOUR = 10;

export type CreateTicketResult =
  | { status: "ok"; conversationId: number | null }
  | { status: "unlinked" }
  | { status: "no_email" }
  | { status: "rate_limited" }
  | { status: "error"; message: string };

interface TicketProfile {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  freescout_customer_id: string | null;
}

async function ensureCustomer(prof: TicketProfile, email: string): Promise<string> {
  if (prof.freescout_customer_id) return String(prof.freescout_customer_id);
  const admin = getAdminClient();
  let customer = await findCustomerByEmail(email);
  if (!customer) {
    customer = await createCustomer(
      email,
      prof.first_name ?? undefined,
      prof.last_name ?? undefined
    );
  }
  const id = String(customer.id);
  await admin.from("profiles").update({ freescout_customer_id: id }).eq("user_id", prof.user_id);
  // support_provisioning_log.user_id is the AUTH uid (audit T-A), not the PK.
  await admin.from("support_provisioning_log").insert({
    user_id: prof.user_id,
    kind: "customer",
    freescout_id: id,
    status: "success",
    attempts: 1,
  });
  return id;
}

/**
 * Idempotency guard: returns the conversation id of a ticket the same member
 * opened with the same subject within `windowSeconds`, else null. Prevents a
 * double-tap / client retry from creating duplicate tickets on either the web
 * or Discord create path. Cheap (one indexed lookup); no extra table.
 */
export async function recentDuplicateTicketId(
  userId: string,
  subject: string,
  windowSeconds = 120
): Promise<number | null> {
  const admin = getAdminClient();
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { data } = await admin
    .from("support_ticket_pointers")
    .select("conversation_id")
    .eq("customer_user_id", userId)
    .eq("subject", subject)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.conversation_id as number | undefined) ?? null;
}

/**
 * Open a Freescout ticket for the member linked to `discordUserId`.
 * Returns a discriminated result so the caller can give the Discord user
 * actionable feedback (link your account / no email / created / failed).
 */
export async function createSupportTicketFromDiscord(
  discordUserId: string,
  subject: string,
  body: string
): Promise<CreateTicketResult> {
  const admin = getAdminClient();

  // Resolve the member via the unique discord_user_id link.
  const { data: prof } = await admin
    .from("profiles")
    .select("id, user_id, email, first_name, last_name, freescout_customer_id")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();
  if (!prof) return { status: "unlinked" };

  // A linked member's profile carries their signup email; if it's somehow blank
  // we fail closed with actionable feedback rather than reaching into auth.users.
  const email = prof.email as string | null;
  if (!email) return { status: "no_email" };

  // Per-member rate limit (abuse/DoS guard; parity with the web create path's
  // 10/hr). T-F: use the ATOMIC increment RPC (single UPSERT … RETURNING count)
  // rather than a read-then-upsert, which raced — two concurrent /support taps
  // both read count=N and both wrote N+1, bypassing the cap. This path has no
  // auth.uid(), so it passes the resolved subject user_id to the service-role
  // variant.
  const { data: rlAllowed, error: rlErr } = await admin.rpc("support_check_rate_limit_for", {
    _subject_user_id: prof.user_id,
    _action: "discord:support",
    _max_per_hour: RATE_LIMIT_PER_HOUR,
  });
  if (rlErr) {
    // Degrade OPEN on a rate-limiter infra error: denying a member their support
    // channel is worse than one un-capped ticket. Surface it for visibility.
    console.error("support_check_rate_limit_for failed:", rlErr.message);
  } else if (rlAllowed === false) {
    void auditEdgeEvent(admin, {
      fn: "discord-interactions",
      event: "support_rate_limited",
      table: "support_rate_limits",
      severity: "warn",
      userId: prof.user_id,
      fields: ["source:discord", "action:discord:support"],
    });
    return { status: "rate_limited" };
  }

  // Idempotency: a double-tap / retry returns the existing ticket, not a dup.
  const dupId = await recentDuplicateTicketId(prof.user_id, subject);
  if (dupId) return { status: "ok", conversationId: dupId };

  try {
    const customerId = await ensureCustomer(prof as TicketProfile, email);
    const created = await freescoutFetch<{ id?: number; conversation?: { id?: number } }>({
      method: "POST",
      path: "/api/conversations",
      body: {
        type: "email",
        subject,
        mailboxId: DEFAULT_MAILBOX_ID,
        status: "active",
        customer: { id: Number(customerId) },
        threads: [{ type: "customer", text: body, customer: { id: Number(customerId) } }],
      },
    });
    const convId = created?.id ?? created?.conversation?.id ?? null;
    if (convId) {
      // Eager pointer (owner = the member's auth uid, matching RLS).
      await admin.from("support_ticket_pointers").upsert(
        {
          conversation_id: Number(convId),
          customer_user_id: prof.user_id,
          freescout_customer_id: customerId,
          subject,
          last_status: "active",
          mailbox_id: DEFAULT_MAILBOX_ID,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "conversation_id" }
      );
    }
    void auditEdgeEvent(admin, {
      fn: "discord-interactions",
      event: "support_ticket_created",
      table: "support_ticket_pointers",
      severity: "info",
      userId: prof.user_id,
      fields: ["source:discord", convId ? `conversation:${convId}` : "conversation:none"],
    });
    return { status: "ok", conversationId: convId ? Number(convId) : null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void auditEdgeEvent(admin, {
      fn: "discord-interactions",
      event: "support_ticket_create_failed",
      table: "support_ticket_pointers",
      severity: "error",
      userId: prof.user_id,
      fields: ["source:discord"],
      errorMessage: message,
    });
    return { status: "error", message };
  }
}
