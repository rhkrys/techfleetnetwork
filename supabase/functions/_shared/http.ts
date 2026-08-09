import { corsHeaders as sdkCorsHeaders } from "npm:@supabase/supabase-js@2.99.1/cors";
import { BodyTooLargeError, readBoundedText } from "./bounded-body.ts";

// Override Access-Control-Allow-Headers to include trace/request headers that
// frontend wrappers attach (e.g. freescoutInvoke sets `x-trace-id`). Without
// this, browser preflight rejects the POST and the function is never invoked —
// surfacing as `*_invoke_error` in agent_fix_queue with zero edge-side logs.
const ALLOWED_REQUEST_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-trace-id, x-request-id";

export const corsHeaders = {
  ...sdkCorsHeaders,
  "Access-Control-Allow-Headers": ALLOWED_REQUEST_HEADERS,
};

export const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  Vary: "Origin",
};

export function handleCors(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders }) : null;
}

export function jsonResponse(body: unknown, status = 200): Response {
  const safeStatus = status >= 100 && status <= 599 ? status : 500;
  return new Response(JSON.stringify(body), {
    status: safeStatus,
    headers: jsonHeaders,
  });
}

export function methodNotAllowed(): Response {
  return jsonResponse({ error: "Method not allowed" }, 405);
}

export async function parseJsonBody(req: Request, maxBytes = 16 * 1024): Promise<unknown> {
  const contentType = req.headers.get("content-type") || "";
  if (!/^application\/(?:[a-z.+-]*\+)?json\b/i.test(contentType)) {
    throw new Response(JSON.stringify({ error: "Content-Type must be application/json" }), {
      status: 415,
      headers: jsonHeaders,
    });
  }

  // Audit T-C: enforce the cap WHILE streaming — do not trust Content-Length,
  // which a caller can omit/understate to buffer an arbitrarily large body.
  let text: string;
  try {
    text = await readBoundedText(req, maxBytes);
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      throw new Response(JSON.stringify({ error: "Request body too large" }), {
        status: 413,
        headers: jsonHeaders,
      });
    }
    throw new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }
}

export function errorResponse(error: unknown, fallback = "Internal server error"): Response {
  if (error instanceof Response) return error;
  return jsonResponse({ error: fallback }, 500);
}
