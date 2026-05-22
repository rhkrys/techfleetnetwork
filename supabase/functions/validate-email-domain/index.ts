import { z } from "npm:zod@4.3.6";
import { handleCors, jsonResponse, parseJsonBody } from "../_shared/http.ts";
import { createEdgeLogger } from "../_shared/logger.ts";
import { withAuditWrapper } from "../_shared/audit.ts";
import { checkEmailDomain } from "../_shared/email-domain-allowlist.ts";

const log = createEdgeLogger("validate-email-domain");

const DOMAIN_RE =
  /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const BodySchema = z.object({
  domain: z.string().trim().toLowerCase().min(4).max(253).regex(DOMAIN_RE),
});

Deno.serve(withAuditWrapper("validate-email-domain", async (req) => {
  // @public-route Pre-auth email signup helper. Input is domain-only and server-side validated.
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") {
    return jsonResponse({ valid: false, error: "Method not allowed" }, 405);
  }

  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();

  // eslint-disable-next-line no-console
  console.log(`[validate-email-domain] ENTER req=${requestId}`);

  let branch = "error";
  let exitStatus = 500;

  try {
    const parsed = BodySchema.safeParse(await parseJsonBody(req, 2 * 1024));
    if (!parsed.success) {
      branch = "validate_fail";
      exitStatus = 400;
      return jsonResponse({ valid: false, error: "Enter a valid email address." }, 400);
    }

    const result = await checkEmailDomain(parsed.data.domain);
    branch = result.branch;
    exitStatus = 200;

    if (!result.valid) {
      log.warn("domain", `Rejected non-existent email domain [${requestId}]`, {
        requestId,
        branch: result.branch,
        domainLength: parsed.data.domain.length,
      });
    }
    return jsonResponse({ valid: result.valid, branch: result.branch });
  } catch (err) {
    branch = "fail_open";
    exitStatus = 200;
    log.warn("domain", `Domain validation failed open [${requestId}]`, { requestId }, err);
    return jsonResponse({ valid: true, warning: "Domain check unavailable" });
  } finally {
    // eslint-disable-next-line no-console
    console.log(`[validate-email-domain] EXIT req=${requestId} status=${exitStatus} branch=${branch} duration_ms=${Date.now() - startedAt}`);
  }
}));
