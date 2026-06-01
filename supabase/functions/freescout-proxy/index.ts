// freescout-proxy — Get Help member/admin actions
// Triple-gated authorization: JWT → role re-check → ownership re-verify
// OWASP A01/A03/A05/A07/A09 hardened. Zod discriminated-union on every action.
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts";
import { getAdminClient } from "../_shared/admin-client.ts";
import { requireAuthenticatedRequest } from "../_shared/request-auth.ts";
import { handleCors, jsonResponse, errorResponse, parseJsonBody, jsonHeaders } from "../_shared/http.ts";
import {
  freescoutFetch,
  findCustomerByEmail,
  createCustomer,
  FreescoutError,
  DEFAULT_MAILBOX_ID,
} from "../_shared/freescout.ts";

const SUBJECT_MAX = 200;
const BODY_MAX = 10_000;

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("listMine"), status: z.enum(["open", "closed", "all"]).default("all"), page: z.number().int().min(1).max(50).default(1) }),
  z.object({ action: z.literal("listAll"), status: z.enum(["open", "closed", "all"]).default("open"), page: z.number().int().min(1).max(50).default(1), mailboxId: z.number().int().optional() }),
  z.object({ action: z.literal("get"), conversationId: z.number().int().positive() }),
  z.object({
    action: z.literal("create"),
    subject: z.string().trim().min(3).max(SUBJECT_MAX).regex(/^[^\u0000-\u001F\u007F]+$/, "Invalid characters"),
    body: z.string().trim().min(1).max(BODY_MAX),
    idempotencyKey: z.string().min(8).max(128).optional(),
  }),
  z.object({
    action: z.literal("reply"),
    conversationId: z.number().int().positive(),
    body: z.string().trim().min(1).max(BODY_MAX),
    idempotencyKey: z.string().min(8).max(128).optional(),
  }),
  z.object({ action: z.literal("close"), conversationId: z.number().int().positive() }),
  z.object({ action: z.literal("reopen"), conversationId: z.number().int().positive() }),
  z.object({ action: z.literal("assign"), conversationId: z.number().int().positive(), assigneeUserId: z.number().int() }),
  z.object({ action: z.literal("setPrivate"), conversationId: z.number().int().positive(), isPrivate: z.boolean() }),
]);

const ADMIN_ACTIONS = new Set(["listAll", "assign", "setPrivate"]);
let loggedInvalidConfig = false;

async function recordConfigInvalidSignal(reason?: string, detail?: string) {
  try {
    await getAdminClient().from("agent_fix_queue").upsert({
      fingerprint: "freescout:config_invalid",
      event_type: "config_invalid",
      source: "freescout-proxy",
      severity: "error",
      status: "pending",
      error_message: detail ?? reason ?? "Freescout configuration is invalid",
      last_seen_at: new Date().toISOString(),
      occurrence_count: 1,
    }, { onConflict: "fingerprint" });
  } catch (err) {
    console.error(JSON.stringify({
      level: "warn",
      fn: "freescout-proxy",
      code: "config_invalid_signal_failed",
      msg: err instanceof Error ? err.message : String(err),
    }));
  }
}

async function isAdmin(userId: string): Promise<boolean> {
  const { data, error } = await getAdminClient().rpc("has_role", { _user_id: userId, _role: "admin" });
  return !error && data === true;
}

async function ensureCustomerForUser(userId: string): Promise<{ customerId: string; email: string; firstName?: string; lastName?: string }> {
  const admin = getAdminClient();
  const { data: prof, error } = await admin
    .from("profiles")
    .select("id, email, first_name, last_name, freescout_customer_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error(JSON.stringify({ level: "error", fn: "freescout-proxy", code: "profile_lookup_failed", userId, msg: error.message }));
    throw new FreescoutError(500, `Profile lookup failed: ${error.message}`);
  }

  // Fallback to auth.users email if profile is missing or its email column is blank —
  // never let a profile-row gap block ticket creation.
  let email = prof?.email ?? null;
  let firstName = prof?.first_name ?? undefined;
  let lastName = prof?.last_name ?? undefined;
  if (!email) {
    const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(userId);
    if (authErr || !authUser?.user?.email) {
      console.error(JSON.stringify({ level: "error", fn: "freescout-proxy", code: "no_email_for_user", userId, profileExists: !!prof }));
      throw new FreescoutError(400, "No email on file for this account. Please add one in your profile.");
    }
    email = authUser.user.email;
    const meta = (authUser.user.user_metadata ?? {}) as Record<string, unknown>;
    firstName = firstName ?? (typeof meta.first_name === "string" ? meta.first_name : undefined);
    lastName = lastName ?? (typeof meta.last_name === "string" ? meta.last_name : undefined);
  }

  if (prof?.freescout_customer_id) {
    return { customerId: String(prof.freescout_customer_id), email, firstName, lastName };
  }

  // Resolve or create the Freescout customer record.
  let customer = await findCustomerByEmail(email);
  if (!customer) {
    customer = await createCustomer(email, firstName, lastName);
  }
  const id = String(customer.id);
  if (prof) {
    await admin.from("profiles").update({ freescout_customer_id: id }).eq("id", userId);
  }
  await admin.from("support_provisioning_log").insert({
    user_id: userId, kind: "customer", freescout_id: id, status: "success", attempts: 1,
  });
  return { customerId: id, email, firstName, lastName };
}

async function ownsConversation(userId: string, conversationId: number): Promise<boolean> {
  // First check our pointer cache
  const admin = getAdminClient();
  const { data: ptr } = await admin
    .from("support_ticket_pointers")
    .select("customer_user_id")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (ptr?.customer_user_id === userId) return true;
  if (ptr && ptr.customer_user_id && ptr.customer_user_id !== userId) return false;

  // Fall back to authoritative Freescout fetch (TOCTOU defense)
  try {
    const conv = await freescoutFetch<{ customer?: { id: number } }>({
      path: `/api/conversations/${encodeURIComponent(String(conversationId))}`,
    });
    const custId = conv?.customer?.id ? String(conv.customer.id) : null;
    if (!custId) return false;
    const { data: prof } = await admin.from("profiles").select("freescout_customer_id").eq("id", userId).maybeSingle();
    return prof?.freescout_customer_id === custId;
  } catch {
    return false;
  }
}

async function upsertPointer(conversationId: number, customerUserId: string | null, fields: Record<string, unknown>) {
  const admin = getAdminClient();
  await admin.from("support_ticket_pointers").upsert({
    conversation_id: conversationId,
    customer_user_id: customerUserId,
    last_synced_at: new Date().toISOString(),
    ...fields,
  });
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let raw: unknown = null;
  try {
    const auth = await requireAuthenticatedRequest(req, "freescout-proxy");
    if (auth instanceof Response) return auth;

    raw = await parseJsonBody(req, 256 * 1024);
    const parsed = Action.safeParse(raw);
    if (!parsed.success) {
      return jsonResponse({ error: "Invalid input", details: parsed.error.flatten() }, 400);
    }
    const input = parsed.data;

    // Admin-only gating
    if (ADMIN_ACTIONS.has(input.action)) {
      if (!(await isAdmin(auth.userId))) return jsonResponse({ error: "Forbidden" }, 403);
    }

    // Rate limit per action
    const rlMap: Record<string, [string, number]> = {
      create: ["support:create", 10],
      reply: ["support:reply", 60],
      assign: ["support:assign", 600],
      setPrivate: ["support:setPrivate", 600],
      close: ["support:close", 60],
      reopen: ["support:reopen", 60],
    };
    if (input.action in rlMap) {
      const [name, max] = rlMap[input.action];
      const userClient = auth.userClient;
      const { error: rlErr } = await userClient.rpc("support_check_rate_limit", {
        _action: name, _max_per_hour: max,
      });
      if (rlErr) return jsonResponse({ error: "Too many requests" }, 429);
    }

    switch (input.action) {
      case "listMine": {
        const { data: prof } = await getAdminClient()
          .from("profiles").select("freescout_customer_id").eq("id", auth.userId).maybeSingle();
        if (!prof?.freescout_customer_id) return jsonResponse({ items: [] });
        const status = input.status === "all" ? undefined : input.status === "open" ? "active" : "closed";
        const data = await freescoutFetch<any>({
          path: "/api/conversations",
          query: {
            customerId: prof.freescout_customer_id,
            status,
            page: input.page,
            embed: "threads",
          },
        });
        return jsonResponse({ items: data?._embedded?.conversations ?? [] });
      }
      case "listAll": {
        const status = input.status === "all" ? undefined : input.status === "open" ? "active" : "closed";
        const data = await freescoutFetch<any>({
          path: "/api/conversations",
          query: {
            mailboxId: input.mailboxId ?? (DEFAULT_MAILBOX_ID || undefined),
            status,
            page: input.page,
          },
        });
        return jsonResponse({ items: data?._embedded?.conversations ?? [] });
      }
      case "get": {
        const admin = await isAdmin(auth.userId);
        if (!admin && !(await ownsConversation(auth.userId, input.conversationId))) {
          return jsonResponse({ error: "Forbidden" }, 403);
        }
        const data = await freescoutFetch<any>({
          path: `/api/conversations/${encodeURIComponent(String(input.conversationId))}`,
          query: { embed: "threads" },
        });
        return jsonResponse({ conversation: data });
      }
      case "create": {
        const cust = await ensureCustomerForUser(auth.userId);
        const created = await freescoutFetch<any>({
          method: "POST",
          path: "/api/conversations",
          body: {
            type: "email",
            subject: input.subject,
            mailboxId: DEFAULT_MAILBOX_ID,
            status: "active",
            customer: { email: cust.email },
            threads: [{
              type: "customer",
              text: input.body,
              customer: { email: cust.email },
            }],
          },
        });
        const convId = created?.id ?? created?.conversation?.id;
        if (convId) {
          await upsertPointer(Number(convId), auth.userId, {
            freescout_customer_id: cust.customerId,
            subject: input.subject,
            last_status: "active",
            mailbox_id: DEFAULT_MAILBOX_ID,
          });
        }
        return jsonResponse({ conversationId: convId });
      }
      case "reply": {
        const admin = await isAdmin(auth.userId);
        if (!admin && !(await ownsConversation(auth.userId, input.conversationId))) {
          return jsonResponse({ error: "Forbidden" }, 403);
        }
        const cust = admin ? null : await ensureCustomerForUser(auth.userId);
        await freescoutFetch({
          method: "POST",
          path: `/api/conversations/${encodeURIComponent(String(input.conversationId))}/threads`,
          body: {
            type: admin ? "message" : "customer",
            text: input.body,
            ...(cust ? { customer: { email: cust.email } } : {}),
          },
        });
        return jsonResponse({ ok: true });
      }
      case "close":
      case "reopen": {
        const admin = await isAdmin(auth.userId);
        if (!admin && !(await ownsConversation(auth.userId, input.conversationId))) {
          return jsonResponse({ error: "Forbidden" }, 403);
        }
        await freescoutFetch({
          method: "PUT",
          path: `/api/conversations/${encodeURIComponent(String(input.conversationId))}`,
          body: { status: input.action === "close" ? "closed" : "active" },
        });
        await upsertPointer(input.conversationId, null, {
          last_status: input.action === "close" ? "closed" : "active",
        });
        return jsonResponse({ ok: true });
      }
      case "assign": {
        await freescoutFetch({
          method: "PUT",
          path: `/api/conversations/${encodeURIComponent(String(input.conversationId))}`,
          body: { assignTo: input.assigneeUserId },
        });
        await upsertPointer(input.conversationId, null, { assignee_user_id: String(input.assigneeUserId) });
        return jsonResponse({ ok: true });
      }
      case "setPrivate": {
        await upsertPointer(input.conversationId, null, { is_private: input.isPrivate });
        return jsonResponse({ ok: true });
      }
    }
  } catch (e) {
    const action = (raw && typeof raw === "object" ? (raw as any).action : undefined) as string | undefined;

    if (e instanceof FreescoutError) {
      const reason = (e.body as { reason?: string; detail?: string })?.reason;
      const detail = (e.body as { detail?: string })?.detail;
      const code = e.status === 503 && e.message === "support_unavailable" ? "config_invalid" : "upstream_error";

      // Always log upstream_error (with body); config_invalid only once per cold start.
      if (code !== "config_invalid" || !loggedInvalidConfig) {
        if (code === "config_invalid") loggedInvalidConfig = true;
        console.error(JSON.stringify({
          level: "error",
          severity: "error",
          fn: "freescout-proxy",
          action,
          status: e.status,
          msg: e.message,
          code,
          reason,
          body: e.body,
        }));
        if (code === "config_invalid") await recordConfigInvalidSignal(reason, detail);
      }

      const READ_ACTIONS = new Set(["listMine", "listAll", "get"]);
      if (e.status === 503 && action && READ_ACTIONS.has(action)) {
        return new Response(
          JSON.stringify({
            items: [],
            conversation: null,
            unavailable: true,
            reason: reason ?? "support_unavailable",
          }),
          {
            status: 200,
            headers: {
              ...jsonHeaders,
              "Content-Type": "application/json",
              "Retry-After": "30",
            },
          },
        );
      }
      return jsonResponse(
        {
          error: e.message,
          unavailable: e.status === 503,
          reason: reason ?? (e.status === 503 ? "support_unavailable" : undefined),
          upstream: e.body ?? undefined,
        },
        e.status >= 400 && e.status < 600 ? e.status : 500,
      );
    }

    console.error(JSON.stringify({
      level: "error",
      severity: "error",
      fn: "freescout-proxy",
      action,
      code: "unhandled_exception",
      msg: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    }));
    return errorResponse(e);
  }
});
