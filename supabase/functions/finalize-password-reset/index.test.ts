import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("AUTH-RESET-025: missing recovery bearer is audit-info, not warn", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

  assertStringIncludes(
    source,
    'requireAuthenticatedRequest(req, "finalize-password-reset", { missingTokenSeverity: "info" })',
  );
});