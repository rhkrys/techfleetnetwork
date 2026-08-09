// Module: supabase/functions/gumroad-webhook (bdd-gate D-13 coverage marker)
// Audit H10 regression — Gumroad lifecycle classification + the 0-row retry rule.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildLifecyclePatch, classifyLifecycle, lifecycleMatchStatus } from "./lifecycle.ts";

const NOW = "2026-08-08T00:00:00.000Z";

Deno.test("H10: 0 matched rows → 409 (retryable), ≥1 → 200", () => {
  // THE fix: a refund/cancel that matches no ledger row must be retried by
  // Gumroad, never acked, or the buyer keeps membership forever.
  assertEquals(lifecycleMatchStatus(0), 409);
  assertEquals(lifecycleMatchStatus(1), 200);
  assertEquals(lifecycleMatchStatus(5), 200);
});

Deno.test("classifyLifecycle: each event type detected via boolean or resource_name", () => {
  assert(classifyLifecycle({ refunded: "true" }).isRefund);
  assert(classifyLifecycle({ resource_name: "refund" }).isRefund);
  assert(classifyLifecycle({ cancelled: "1" }).isCancelled);
  assert(classifyLifecycle({ ended: "yes" }).isEnded);
  assert(classifyLifecycle({ resource_name: "subscription_ended" }).isEnded);
  assert(!classifyLifecycle({ refunded: "false" }).isLifecycle);
  assert(!classifyLifecycle({}).isLifecycle);
});

Deno.test("classifyLifecycle: a WON dispute is not a downgrade", () => {
  assert(!classifyLifecycle({ disputed: "true", dispute_won: "true" }).isDispute);
  assert(classifyLifecycle({ disputed: "true", dispute_won: "false" }).isDispute);
});

Deno.test("buildLifecyclePatch: sets only the relevant timestamp columns", () => {
  const patch = buildLifecyclePatch(classifyLifecycle({ refunded: "true" }), NOW);
  assertEquals(patch, { refunded_at: NOW });
  const both = buildLifecyclePatch(classifyLifecycle({ cancelled: "true", ended: "true" }), NOW);
  assertEquals(both, { subscription_cancelled_at: NOW, subscription_ended_at: NOW });
});
