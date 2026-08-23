// Tests for the announcement not-marketing attestation gate (PR 7). Run via ci.yml Edge unit gates.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { requireMarketingAttestation } from "./attestation.ts";

Deno.test("passes only on a literal boolean true", () => {
  assertEquals(requireMarketingAttestation({ marketing_attested: true }).ok, true);
});

Deno.test("rejects missing / false / non-boolean-truthy values", () => {
  for (const body of [
    {},
    { marketing_attested: false },
    { marketing_attested: "true" },
    { marketing_attested: 1 },
    null,
    undefined,
  ]) {
    const r = requireMarketingAttestation(body);
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.error, "marketing_attestation_required");
  }
});
