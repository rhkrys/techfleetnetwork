// Contract tests for the Email Octopus v2 client (PR 6b). No network — fetch is injected.
// Run in CI via ci.yml deno-check "Edge unit gates".
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  contactId,
  eoConfigFromEnv,
  fetchContactStatus,
  pushDesiredState,
  type EoConfig,
} from "./client.ts";

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Build a mock fetch that records the request and returns a canned Response. */
function mockFetch(status: number, json: unknown, sink: Captured[]): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => {
    const h: Record<string, string> = {};
    const raw = (init?.headers ?? {}) as Record<string, string>;
    for (const k of Object.keys(raw)) h[k] = raw[k];
    sink.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: h,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return Promise.resolve(
      new Response(JSON.stringify(json), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    );
  }) as unknown as typeof fetch;
}

function cfg(
  over: Partial<EoConfig>,
  sink: Captured[],
  status = 200,
  json: unknown = {}
): EoConfig {
  return {
    apiKey: "key_abc",
    listId: "list-123",
    fetchImpl: mockFetch(status, json, sink),
    ...over,
  };
}

Deno.test(
  "subscribe: PUT /contacts, bearer auth, lowercased email, status subscribed",
  async () => {
    const sink: Captured[] = [];
    const r = await pushDesiredState(cfg({}, sink), {
      email: "  Ada@Example.COM ",
      desiredStatus: "subscribed",
    });
    assertEquals(r.outcome, "synced");
    assertEquals(sink.length, 1);
    assertEquals(sink[0].method, "PUT");
    assertEquals(sink[0].url, "https://api.emailoctopus.com/lists/list-123/contacts");
    assertEquals(sink[0].headers["Authorization"], "Bearer key_abc");
    assertEquals(sink[0].body, { email_address: "ada@example.com", status: "subscribed" });
  }
);

Deno.test("subscribe with firstNameField configured sends the mapped custom field", async () => {
  const sink: Captured[] = [];
  await pushDesiredState(cfg({ firstNameField: "FirstName" }, sink), {
    email: "ada@example.com",
    desiredStatus: "subscribed",
    fields: { first_name: "Ada" },
  });
  assertEquals((sink[0].body as { fields?: unknown }).fields, { FirstName: "Ada" });
});

Deno.test(
  "subscribe WITHOUT a firstNameField never sends custom fields (avoids 422 loop)",
  async () => {
    const sink: Captured[] = [];
    await pushDesiredState(cfg({ firstNameField: null }, sink), {
      email: "ada@example.com",
      desiredStatus: "subscribed",
      fields: { first_name: "Ada" },
    });
    assert(!("fields" in (sink[0].body as Record<string, unknown>)));
  }
);

Deno.test(
  "unsubscribe uses the same email-keyed PUT with status unsubscribed (no contact id)",
  async () => {
    const sink: Captured[] = [];
    const r = await pushDesiredState(cfg({}, sink), {
      email: "ada@example.com",
      desiredStatus: "unsubscribed",
    });
    assertEquals(r.outcome, "synced");
    assertEquals(sink[0].method, "PUT");
    assertEquals(sink[0].url, "https://api.emailoctopus.com/lists/list-123/contacts");
    assertEquals(sink[0].body, { email_address: "ada@example.com", status: "unsubscribed" });
  }
);

Deno.test("delete uses DELETE with the md5(email) contact id", async () => {
  const sink: Captured[] = [];
  const r = await pushDesiredState(cfg({}, sink), {
    email: "Ada@Example.com",
    desiredStatus: "deleted",
  });
  assertEquals(r.outcome, "synced");
  assertEquals(sink[0].method, "DELETE");
  assertEquals(
    sink[0].url,
    `https://api.emailoctopus.com/lists/list-123/contacts/${contactId("ada@example.com")}`
  );
  assert(/^[0-9a-f]{32}$/.test(contactId("ada@example.com")));
});

Deno.test("delete returning 404 is idempotent success (contact already gone)", async () => {
  const sink: Captured[] = [];
  const r = await pushDesiredState(cfg({}, sink, 404, { detail: "not found" }), {
    email: "ada@example.com",
    desiredStatus: "deleted",
  });
  assertEquals(r.outcome, "synced");
  assertEquals(r.statusCode, 404);
});

Deno.test("429 rate limit -> retry", async () => {
  const sink: Captured[] = [];
  const r = await pushDesiredState(cfg({}, sink, 429, { detail: "rate limited" }), {
    email: "ada@example.com",
    desiredStatus: "subscribed",
  });
  assertEquals(r.outcome, "retry");
  assertEquals(r.statusCode, 429);
});

Deno.test("401/403 -> retry (config not fixed yet; never drop the intent)", async () => {
  for (const code of [401, 403]) {
    const sink: Captured[] = [];
    const r = await pushDesiredState(cfg({}, sink, code, { detail: "denied" }), {
      email: "ada@example.com",
      desiredStatus: "unsubscribed",
    });
    assertEquals(r.outcome, "retry");
  }
});

Deno.test("422 validation -> permanent_fail with the RFC7807 detail", async () => {
  const sink: Captured[] = [];
  const r = await pushDesiredState(cfg({}, sink, 422, { detail: "email_address invalid" }), {
    email: "ada@example.com",
    desiredStatus: "subscribed",
  });
  assertEquals(r.outcome, "permanent_fail");
  assertEquals(r.error, "email_address invalid");
});

Deno.test(
  "400 'Bad request.' captures title + errors so the DLQ names the real cause",
  async () => {
    const sink: Captured[] = [];
    const r = await pushDesiredState(
      cfg({}, sink, 400, {
        title: "Bad request.",
        errors: [{ pointer: "/fields/FirstName", message: "Unknown field" }],
      }),
      { email: "ada@example.com", desiredStatus: "subscribed" }
    );
    assertEquals(r.outcome, "permanent_fail");
    assert(r.error?.includes("Bad request."));
    assert(r.error?.includes("Unknown field"));
  }
);

Deno.test("network throw -> retry with null status code", async () => {
  const throwing = (() => Promise.reject(new Error("ECONNRESET"))) as unknown as typeof fetch;
  const r = await pushDesiredState(
    { apiKey: "k", listId: "l", fetchImpl: throwing },
    { email: "ada@example.com", desiredStatus: "unsubscribed" }
  );
  assertEquals(r.outcome, "retry");
  assertEquals(r.statusCode, null);
  assert(r.error?.startsWith("network:"));
});

Deno.test("fetchContactStatus: GET by md5, maps EO status to the live value", async () => {
  const sink: Captured[] = [];
  const r = await fetchContactStatus(
    cfg({}, sink, 200, { status: "subscribed" }),
    "Ada@Example.com"
  );
  assertEquals(r.status, "subscribed");
  assertEquals(sink[0].method, "GET");
  assertEquals(
    sink[0].url,
    `https://api.emailoctopus.com/lists/list-123/contacts/${contactId("ada@example.com")}`
  );
});

Deno.test("fetchContactStatus: 200 unsubscribed -> unsubscribed", async () => {
  const sink: Captured[] = [];
  const r = await fetchContactStatus(
    cfg({}, sink, 200, { status: "unsubscribed" }),
    "ada@example.com"
  );
  assertEquals(r.status, "unsubscribed");
});

Deno.test("fetchContactStatus: 404 -> not_found (contact not on the list)", async () => {
  const sink: Captured[] = [];
  const r = await fetchContactStatus(
    cfg({}, sink, 404, { detail: "not found" }),
    "ada@example.com"
  );
  assertEquals(r.status, "not_found");
  assertEquals(r.statusCode, 404);
});

Deno.test(
  "fetchContactStatus: server error / network -> unknown (caller falls back to cache)",
  async () => {
    const sink: Captured[] = [];
    const r1 = await fetchContactStatus(cfg({}, sink, 500, { detail: "boom" }), "ada@example.com");
    assertEquals(r1.status, "unknown");
    const throwing = (() => Promise.reject(new Error("down"))) as unknown as typeof fetch;
    const r2 = await fetchContactStatus(
      { apiKey: "k", listId: "l", fetchImpl: throwing },
      "ada@example.com"
    );
    assertEquals(r2.status, "unknown");
    assertEquals(r2.statusCode, null);
  }
);

Deno.test(
  "double opt-in: subscribe is sent as status 'pending' (EO sends the confirmation)",
  async () => {
    const sink: Captured[] = [];
    await pushDesiredState(cfg({ doubleOptIn: true }, sink), {
      email: "ada@example.com",
      desiredStatus: "subscribed",
    });
    assertEquals((sink[0].body as { status?: string }).status, "pending");
  }
);

Deno.test("double opt-in: unsubscribe stays 'unsubscribed'", async () => {
  const sink: Captured[] = [];
  await pushDesiredState(cfg({ doubleOptIn: true }, sink), {
    email: "ada@example.com",
    desiredStatus: "unsubscribed",
  });
  assertEquals((sink[0].body as { status?: string }).status, "unsubscribed");
});

Deno.test("single opt-in (default): subscribe is sent as 'subscribed'", async () => {
  const sink: Captured[] = [];
  await pushDesiredState(cfg({}, sink), { email: "ada@example.com", desiredStatus: "subscribed" });
  assertEquals((sink[0].body as { status?: string }).status, "subscribed");
});

Deno.test("eoConfigFromEnv parses EMAILOCTOPUS_DOUBLE_OPT_IN", () => {
  const set = new Map([
    ["EMAILOCTOPUS_API_KEY", "key"],
    ["EMAILOCTOPUS_LIST_ID", "list"],
    ["EMAILOCTOPUS_DOUBLE_OPT_IN", "true"],
  ]);
  assertEquals(eoConfigFromEnv({ get: (k) => set.get(k) })?.doubleOptIn, true);
});

Deno.test("eoConfigFromEnv returns null when secrets are absent (feature flag = presence)", () => {
  const empty = new Map<string, string>();
  assertEquals(eoConfigFromEnv({ get: (k) => empty.get(k) }), null);

  const set = new Map([
    ["EMAILOCTOPUS_API_KEY", "key"],
    ["EMAILOCTOPUS_LIST_ID", "list"],
  ]);
  const c = eoConfigFromEnv({ get: (k) => set.get(k) });
  assert(c);
  assertEquals(c?.listId, "list");
});
