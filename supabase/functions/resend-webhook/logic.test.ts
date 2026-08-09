// Module: supabase/functions/resend-webhook (bdd-gate D-13 coverage marker)
// Unit tests for the webhook's security-relevant decision logic: only HARD
// events suppress, transient/positive events never restrict sending, and logs
// redact PII. See resend-webhook.feature for the @security scenarios.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyResendEvent, normalizeRecipient, redactEmail } from "./logic.ts";

Deno.test("hard bounce → suppress as bounced", () => {
  assertEquals(classifyResendEvent("email.bounced"), {
    kind: "suppress",
    reason: "bounce",
    status: "bounced",
  });
});

Deno.test("complaint → suppress as complained", () => {
  assertEquals(classifyResendEvent("email.complained"), {
    kind: "suppress",
    reason: "complaint",
    status: "complained",
  });
});

Deno.test(
  "delivered / delayed / sent are logged, never suppressed (business-logic control)",
  () => {
    for (const t of ["email.delivered", "email.delivery_delayed", "email.sent"]) {
      assertEquals(classifyResendEvent(t).kind, "log");
    }
  }
);

Deno.test("unknown event types are ignored, not suppressed", () => {
  assertEquals(classifyResendEvent("email.opened").kind, "ignore");
  assertEquals(classifyResendEvent("").kind, "ignore");
});

Deno.test("normalizeRecipient handles string, array, and empty", () => {
  assertEquals(normalizeRecipient("  A@Example.COM "), "a@example.com");
  assertEquals(normalizeRecipient(["First@x.com", "b@x.com"]), "first@x.com");
  assertEquals(normalizeRecipient(undefined), "");
  assertEquals(normalizeRecipient(null), "");
});

Deno.test("redactEmail masks the local-part (no PII in logs)", () => {
  assertEquals(redactEmail("person@example.com"), "p***@example.com");
  // never leaks the full local-part
  assert(!redactEmail("longlocalpart@example.com").includes("longlocalpart"));
  assertEquals(redactEmail("garbage-no-at"), "***");
});
