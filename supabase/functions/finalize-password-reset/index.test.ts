import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { requireAuthenticatedRequest } from "../_shared/request-auth.ts";

function auditSpy() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

Deno.test("AUTH-RESET-025: missing recovery bearer returns 401 and audits info, not warn", async () => {
  const client = auditSpy();
  const response = await requireAuthenticatedRequest(
    new Request("https://example.test/finalize-password-reset", { method: "POST" }),
    "finalize-password-reset",
    { missingTokenSeverity: "info", auditClient: client as never },
  );
  await Promise.resolve();

  assertEquals(response instanceof Response, true);
  assertEquals((response as Response).status, 401);
  await (response as Response).text();
  const auditCall = client.calls.find((call) => call.name === "write_audit_log");
  assertEquals(Boolean(auditCall), true);
  assertEquals((auditCall!.args.p_changed_fields as string[]).includes("severity:info"), true);
  assertEquals((auditCall!.args.p_changed_fields as string[]).includes("severity:warn"), false);
});