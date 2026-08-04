// @edge-auth
// freescout-proxy — Get Help member/admin actions
// Constants-based config (see _shared/freescout.ts). No runtime config branch.
// Layered cache (see _shared/freescoutCache.ts) collapses fan-out on read.
// Triple-gated authorization: JWT → role re-check → ownership re-verify.
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
import { resolveAdminFreescoutUserId } from "../_shared/freescout-admin.ts";
import {
  cacheKey,
  getCached,
  setCached,
  tagForUser,
  invalidateUser,
  invalidateAll,
} from "../_shared/freescoutCache.ts";

const SUBJECT_MAX = 200;
const BODY_MAX = 10_000;

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("listMine"), status: z.enum(["open", "closed", "all"]).default("all"), page: z.number().int().min(1).max(50).default(1) }),
  z.object({
    action: z.literal("listAll"),
    status: z.enum(["open", "closed", "all"]).default("open"),
    page: z.number().int().min(1).max(50).default(1),
    mailboxId: z.number().int().optional(),
    assigned: z.enum(["assigned", "unassigned", "any"]).default("any"),
  }),
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
  z.object({
    action: z.literal("assign"),
    conversationId: z.number().int().positive(),
    // "self" = the calling admin; a UUID = another admin. The target is verified
    // to be an admin and resolved+provisioned to a Freescout user id server-side.
    // Raw numeric Freescout ids are no longer accepted from the client (that let
    // an admin target ANY upstream Freescout user, including non-admins).
    assigneeUserId: z.union([z.literal("self"), z.string().uuid()]),
  }),
  z.object({ action: z.literal("setPrivate"), conversationId: z.number().int().positive(), isPrivate: z.boolean() }),
  z.object({ action: z.literal("setCategory"), conversationId: z.number().int().positive(), categoryId: z.string().uuid().nullable() }),
]);

const ADMIN_ACTIONS = new Set(["listAll", "assign", "setPrivate", "setCategory"]);

const READ_CACHE_TTL_MS: Record<string, number> = {
  listMine: 30_000,
  listAll: 30_000,
  get: 10_000,
};

async function isAdmin(userId: string): Promise<boolean> {
  const { data, error } = await getAdminClient().rpc("has_role", { _user_id: userId, _role: "admin" });
  return !error && data === true;
}

async function ensureCustomerForUser(userId: string): Promise<{ customerId: string; email: string; firstName?: string; lastName?: string }> {
  const admin = getAdminClient();
  const { data: prof, error } = await admin
    .from("profiles")
    .select("id, email, first_name, last_name, freescout_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error(JSON.stringify({ level: "error", fn: "freescout-proxy", code: "profile_lookup_failed", userId, msg: error.message }));
    throw new FreescoutError(500, `Profile lookup failed: ${error.message}`);
  }

  let email = prof?.email ?? null;
  let firstName = prof?.first_name ?? undefined;
  let lastName = prof?.last_name ?? undefined;
  if (!email) {
    const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(userId);
    if (authErr || !authUser?.user?.email) {
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

  let customer = await findCustomerByEmail(email);
  if (!customer) customer = await createCustomer(email, firstName, lastName);
  const id = String(customer.id);
  if (prof) {
    await admin.from("profiles").update({ freescout_customer_id: id }).eq("user_id", userId);
  }
  await admin.from("support_provisioning_log").insert({
    user_id: prof?.id ?? userId, kind: "customer", freescout_id: id, status: "success", attempts: 1,
  });
  return { customerId: id, email, firstName, lastName };
}

async function ownsConversation(userId: string, conversationId: number): Promise<boolean> {
  const admin = getAdminClient();
  const { data: ptr } = await admin
    .from("support_ticket_pointers")
    .select("customer_user_id")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (ptr?.customer_user_id === userId) return true;
  if (ptr && ptr.customer_user_id && ptr.customer_user_id !== userId) return false;

  try {
    const conv = await freescoutFetch<{ customer?: { id: number } }>({
      path: `/api/conversations/${encodeURIComponent(String(conversationId))}`,
    });
    const custId = conv?.customer?.id ? String(conv.customer.id) : null;
    if (!custId) return false;
    const { data: prof } = await admin.from("profiles").select("freescout_customer_id").eq("user_id", userId).maybeSingle();
    return prof?.freescout_customer_id === custId;
  } catch {
    return false;
  }
}

async function upsertPointer(conversationId: number, customerUserId: string | null, fields: Record<string, unknown>) {
  const admin = getAdminClient();
  const row: Record<string, unknown> = {
    conversation_id: conversationId,
    last_synced_at: new Date().toISOString(),
    ...fields,
  };
  // Only write customer_user_id when the caller is asserting ownership (create).
  // Passing null means "don't touch the owner" — otherwise an admin close/reopen/
  // assign/setPrivate would upsert customer_user_id=null onto the PK and wipe the
  // member's ownership, and since RLS "members see own pointers" is
  // customer_user_id = auth.uid(), the member would lose visibility of their own
  // ticket the moment an admin acts on it.
  if (customerUserId !== null) row.customer_user_id = customerUserId;
  await admin.from("support_ticket_pointers").upsert(row, { onConflict: "conversation_id" });
}

function cacheableResponse(body: unknown, ttlSec: number): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...jsonHeaders, "Cache-Control": `private, max-age=${ttlSec}` },
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

    if (ADMIN_ACTIONS.has(input.action)) {
      if (!(await isAdmin(auth.userId))) return jsonResponse({ error: "Forbidden" }, 403);
    }

    const rlMap: Record<string, [string, number]> = {
      create: ["support:create", 10],
      reply: ["support:reply", 60],
      assign: ["support:assign", 600],
      setPrivate: ["support:setPrivate", 600],
      setCategory: ["support:setCategory", 600],
      close: ["support:close", 60],
      reopen: ["support:reopen", 60],
    };
    if (input.action in rlMap) {
      const [name, max] = rlMap[input.action];
      const { error: rlErr } = await auth.userClient.rpc("support_check_rate_limit", {
        _action: name, _max_per_hour: max,
      });
      if (rlErr) return jsonResponse({ error: "Too many requests" }, 429);
    }

    // Cache lookup for reads
    if (input.action in READ_CACHE_TTL_MS) {
      const k = await cacheKey(auth.userId, input.action, input);
      const hit = getCached(k);
      if (hit) {
        return cacheableResponse(hit, Math.floor(READ_CACHE_TTL_MS[input.action] / 1000));
      }
      // tag pre-emptively; we'll fill cache below
      tagForUser(auth.userId, k);
      // Stash key on input scope by closure for setCached after fetch
      (input as { _cacheKey?: string })._cacheKey = k;
    }

    switch (input.action) {
      case "listMine": {
        const { data: prof } = await getAdminClient()
          .from("profiles").select("freescout_customer_id").eq("user_id", auth.userId).maybeSingle();
        if (!prof?.freescout_customer_id) {
          const body = { items: [] };
          const k = (input as { _cacheKey?: string })._cacheKey;
          if (k) setCached(k, body, READ_CACHE_TTL_MS.listMine);
          return cacheableResponse(body, 30);
        }
        const status = input.status === "all" ? undefined : input.status === "open" ? "active" : "closed";
        // Fetch profile email so we can also filter by customerEmail — covers legacy
        // conversations that Freescout linked by email to a different customer id.
        const { data: profEmail } = await getAdminClient()
          .from("profiles").select("email").eq("user_id", auth.userId).maybeSingle();
        const data = await freescoutFetch<{ _embedded?: { conversations?: unknown[] } }>({
          path: "/api/conversations",
          query: {
            customerId: prof.freescout_customer_id,
            customerEmail: profEmail?.email ?? undefined,
            status, page: input.page, embed: "threads",
          },
        });
        const body = { items: data?._embedded?.conversations ?? [] };
        const k = (input as { _cacheKey?: string })._cacheKey;
        if (k) setCached(k, body, READ_CACHE_TTL_MS.listMine);
        return cacheableResponse(body, 30);
      }
      case "listAll": {
        const status = input.status === "all" ? undefined : input.status === "open" ? "active" : "closed";
        const data = await freescoutFetch<{ _embedded?: { conversations?: unknown[] } }>({
          path: "/api/conversations",
          query: {
            mailboxId: input.mailboxId ?? DEFAULT_MAILBOX_ID,
            status, page: input.page,
          },
        });
        let items = (data?._embedded?.conversations ?? []) as Array<{ id?: number; assignee?: unknown }>;
        if (input.assigned === "unassigned") {
          items = items.filter((c) => c.assignee == null);
        } else if (input.assigned === "assigned") {
          items = items.filter((c) => c.assignee != null);
        }
        // Enrich with platform-side pointer data (category + private flag) that
        // Freescout doesn't hold — one pointer query + one category lookup per page.
        const ids = items.map((c) => c.id).filter((n): n is number => typeof n === "number");
        if (ids.length > 0) {
          const client = getAdminClient();
          const [{ data: ptrs }, { data: cats }] = await Promise.all([
            client.from("support_ticket_pointers").select("conversation_id, is_private, category_id").in("conversation_id", ids),
            client.from("support_categories").select("id, label"),
          ]);
          const catById = new Map<string, string>((cats ?? []).map((c) => [c.id, c.label]));
          const ptrById = new Map((ptrs ?? []).map((p) => [p.conversation_id, p]));
          items = items.map((c) => {
            const p = c.id != null ? ptrById.get(c.id) : undefined;
            const categoryId = p?.category_id ?? null;
            return {
              ...c,
              isPrivate: p?.is_private ?? false,
              categoryId,
              category: categoryId ? (catById.get(categoryId) ?? null) : null,
            };
          });
        }
        const body = { items };
        const k = (input as { _cacheKey?: string })._cacheKey;
        if (k) setCached(k, body, READ_CACHE_TTL_MS.listAll);
        return cacheableResponse(body, 30);
      }
      case "get": {
        const admin = await isAdmin(auth.userId);
        if (!admin && !(await ownsConversation(auth.userId, input.conversationId))) {
          return jsonResponse({ error: "Forbidden" }, 403);
        }
        const data = await freescoutFetch({
          path: `/api/conversations/${encodeURIComponent(String(input.conversationId))}`,
          query: { embed: "threads" },
        });
        const body = { conversation: data };
        const k = (input as { _cacheKey?: string })._cacheKey;
        if (k) setCached(k, body, READ_CACHE_TTL_MS.get);
        return cacheableResponse(body, 10);
      }
      case "create": {
        // Idempotency: a double-submit / retry returns the existing ticket
        // instead of creating a duplicate (same 2-min subject+owner window the
        // Discord create path uses via _shared/support-ticket.recentDuplicateTicketId;
        // inlined here to avoid mixing supabase-js versions in this module).
        {
          const since = new Date(Date.now() - 120_000).toISOString();
          const { data: dup } = await getAdminClient()
            .from("support_ticket_pointers")
            .select("conversation_id")
            .eq("customer_user_id", auth.userId)
            .eq("subject", input.subject)
            .gte("created_at", since)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (dup?.conversation_id) return jsonResponse({ conversationId: dup.conversation_id, deduped: true });
        }
        const cust = await ensureCustomerForUser(auth.userId);
        const created = await freescoutFetch<{ id?: number; conversation?: { id?: number } }>({
          method: "POST", path: "/api/conversations",
          body: {
            type: "email",
            subject: input.subject,
            mailboxId: DEFAULT_MAILBOX_ID,
            status: "active",
            customer: cust.customerId
              ? { id: Number(cust.customerId) }
              : { email: cust.email },
            threads: [{
              type: "customer",
              text: input.body,
              customer: cust.customerId
                ? { id: Number(cust.customerId) }
                : { email: cust.email },
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
        invalidateUser(auth.userId);
        invalidateAll(); // admin views need to see the new ticket too
        return jsonResponse({ conversationId: convId });
      }
      case "reply": {
        const admin = await isAdmin(auth.userId);
        if (!admin && !(await ownsConversation(auth.userId, input.conversationId))) {
          return jsonResponse({ error: "Forbidden" }, 403);
        }
        const adminUserId = admin
          ? await resolveAdminFreescoutUserId(auth.userId, { traceId: req.headers.get("x-trace-id") })
          : null;
        const cust = admin ? null : await ensureCustomerForUser(auth.userId);
        await freescoutFetch({
          method: "POST",
          path: `/api/conversations/${encodeURIComponent(String(input.conversationId))}/threads`,
          body: {
            type: admin ? "message" : "customer",
            text: input.body,
            ...(adminUserId ? { user: adminUserId } : {}),
            ...(cust ? { customer: { email: cust.email } } : {}),
          },
        });
        invalidateUser(auth.userId);
        invalidateAll();
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
        invalidateAll();
        return jsonResponse({ ok: true });
      }
      case "assign": {
        const traceId = req.headers.get("x-trace-id");
        // Resolve the assignee's Freescout user id, provisioning on demand.
        // A UUID target must itself be an admin — you cannot assign a ticket to a
        // non-admin member.
        let assigneeId: number;
        if (input.assigneeUserId === "self") {
          assigneeId = await resolveAdminFreescoutUserId(auth.userId, { traceId });
        } else {
          if (!(await isAdmin(input.assigneeUserId))) {
            return jsonResponse({ error: "Assignee must be an admin" }, 422);
          }
          assigneeId = await resolveAdminFreescoutUserId(input.assigneeUserId, { traceId });
        }
        await freescoutFetch({
          method: "PUT",
          path: `/api/conversations/${encodeURIComponent(String(input.conversationId))}`,
          body: { assignTo: assigneeId },
        });
        // Store the assignee's PLATFORM uuid (meaningful in our system; the grid
        // shows the name from Freescout). null owner arg preserves customer_user_id.
        const assigneePlatformId = input.assigneeUserId === "self" ? auth.userId : input.assigneeUserId;
        await upsertPointer(input.conversationId, null, { assignee_user_id: assigneePlatformId });
        invalidateAll();
        return jsonResponse({ ok: true });
      }
      case "setPrivate": {
        await upsertPointer(input.conversationId, null, { is_private: input.isPrivate });
        invalidateAll();
        return jsonResponse({ ok: true });
      }
      case "setCategory": {
        // Validate the category exists + is active (reject a stale/forged id).
        // null clears the category. Platform-side only — no Freescout call.
        if (input.categoryId) {
          const { data: cat } = await getAdminClient()
            .from("support_categories").select("id")
            .eq("id", input.categoryId).eq("is_active", true).maybeSingle();
          if (!cat) return jsonResponse({ error: "Unknown category" }, 422);
        }
        await upsertPointer(input.conversationId, null, { category_id: input.categoryId });
        invalidateAll();
        return jsonResponse({ ok: true });
      }
    }
  } catch (e) {
    const action = (raw && typeof raw === "object" ? (raw as { action?: string }).action : undefined);
    if (e instanceof FreescoutError) {
      console.error(JSON.stringify({
        level: "error", fn: "freescout-proxy", action,
        status: e.status, code: "upstream_error",
        msg: e.message, body: e.body,
      }));
      return jsonResponse(
        { error: e.message, upstream: e.body ?? undefined },
        e.status >= 400 && e.status < 600 ? e.status : 500,
      );
    }
    console.error(JSON.stringify({
      level: "error", fn: "freescout-proxy", action,
      code: "unhandled_exception",
      msg: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    }));
    return errorResponse(e);
  }
});
