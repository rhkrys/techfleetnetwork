// Unit tests for the eo-contact-status decision core (self-only live EO read). Run via ci.yml.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveMarketingStatus } from "./status-core.ts";

const base = {
  getUserId: () => Promise.resolve("u1"),
  eoEnabled: true,
  getEmail: () => Promise.resolve("ada@example.com"),
  fetchStatus: () => Promise.resolve("subscribed" as const),
};

Deno.test("unauthenticated caller -> 401 unknown (no EO read)", async () => {
  let fetched = false;
  const r = await resolveMarketingStatus({
    ...base,
    getUserId: () => Promise.resolve(null),
    fetchStatus: () => {
      fetched = true;
      return Promise.resolve("subscribed");
    },
  });
  assertEquals(r, { status: "unknown", reason: "unauthenticated", http: 401 });
  assertEquals(fetched, false);
});

Deno.test("EO disabled -> 200 unknown (client falls back to cache)", async () => {
  const r = await resolveMarketingStatus({ ...base, eoEnabled: false });
  assertEquals(r, { status: "unknown", reason: "disabled", http: 200 });
});

Deno.test("no email on profile -> 200 unknown", async () => {
  const r = await resolveMarketingStatus({ ...base, getEmail: () => Promise.resolve(null) });
  assertEquals(r, { status: "unknown", reason: "no_email", http: 200 });
});

Deno.test("authenticated + enabled -> live EO status, 200", async () => {
  const r = await resolveMarketingStatus({
    ...base,
    fetchStatus: () => Promise.resolve("unsubscribed"),
  });
  assertEquals(r, { status: "unsubscribed", http: 200 });
});

Deno.test(
  "self-only: getEmail is called with the caller's own id, never a request value",
  async () => {
    let seenId: string | null = null;
    await resolveMarketingStatus({
      ...base,
      getUserId: () => Promise.resolve("caller-42"),
      getEmail: (id) => {
        seenId = id;
        return Promise.resolve("x@y.com");
      },
    });
    assertEquals(seenId, "caller-42");
  }
);
