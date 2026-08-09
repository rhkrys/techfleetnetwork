// Module: supabase/functions/_shared (bdd-gate D-13 coverage marker)
// Audit H5 regression — `withIdempotency` must isolate the cache PER USER.
//
// Before the fix, the stored key was the caller-supplied X-Request-Id alone and
// the RPC filtered on that key only, so two users reusing the same request id +
// body would read each other's cached (private) response. These tests assert the
// storage key and request hash are now namespaced by the authenticated user, so
// distinct users can never collide, while the same user stays idempotent.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { withIdempotency } from "./idempotency.ts";

type RpcCall = { name: string; args: Record<string, unknown> };

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function jwtFor(sub: string): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub })}.sig`;
}

function fakeSupabase(calls: RpcCall[]) {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "claim_idempotency_key") {
        // Always report first-claim so the handler runs and we can inspect keys.
        return Promise.resolve({
          data: { claimed: true, cached_response: null, status: "in_flight" },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function reqFor(sub: string, key: string, body: string): Request {
  return new Request("https://proj.functions.supabase.co/fn", {
    method: "POST",
    headers: { authorization: `Bearer ${jwtFor(sub)}`, "x-request-id": key },
    body,
  });
}

const handler = () =>
  Promise.resolve(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

Deno.test("H5: same key+body, different users → isolated storage keys", async () => {
  const calls: RpcCall[] = [];
  const sb = fakeSupabase(calls) as unknown as Parameters<typeof withIdempotency>[1];
  await withIdempotency(reqFor(USER_A, "shared-req-id-abc", '{"a":1}'), sb, handler);
  await withIdempotency(reqFor(USER_B, "shared-req-id-abc", '{"a":1}'), sb, handler);
  const claimKeys = calls
    .filter((c) => c.name === "claim_idempotency_key")
    .map((c) => c.args.p_key as string);
  assertEquals(claimKeys.length, 2);
  assertNotEquals(claimKeys[0], claimKeys[1], "different users must not share a storage key");
  // Namespaced keys are sha256 hex (64 chars), never the raw caller key.
  assert(/^[0-9a-f]{64}$/.test(claimKeys[0]));
  assertNotEquals(claimKeys[0], "shared-req-id-abc");
});

Deno.test("H5: same user+key+body → identical storage key (idempotency preserved)", async () => {
  const calls: RpcCall[] = [];
  const sb = fakeSupabase(calls) as unknown as Parameters<typeof withIdempotency>[1];
  await withIdempotency(reqFor(USER_A, "same-req-id-xyz", '{"a":1}'), sb, handler);
  await withIdempotency(reqFor(USER_A, "same-req-id-xyz", '{"a":1}'), sb, handler);
  const claimKeys = calls
    .filter((c) => c.name === "claim_idempotency_key")
    .map((c) => c.args.p_key as string);
  assertEquals(claimKeys[0], claimKeys[1], "same user+key must map to one storage key");
});

Deno.test("H5: request hash is user-scoped (different users → different hash)", async () => {
  const calls: RpcCall[] = [];
  const sb = fakeSupabase(calls) as unknown as Parameters<typeof withIdempotency>[1];
  await withIdempotency(reqFor(USER_A, "hash-req-id-1", '{"a":1}'), sb, handler);
  await withIdempotency(reqFor(USER_B, "hash-req-id-1", '{"a":1}'), sb, handler);
  const hashes = calls
    .filter((c) => c.name === "claim_idempotency_key")
    .map((c) => c.args.p_request_hash as string);
  assertNotEquals(hashes[0], hashes[1], "request hash must incorporate the user identity");
});

Deno.test("H5: complete_idempotency writes back under the SAME namespaced key", async () => {
  const calls: RpcCall[] = [];
  const sb = fakeSupabase(calls) as unknown as Parameters<typeof withIdempotency>[1];
  await withIdempotency(reqFor(USER_A, "complete-req-id", '{"a":1}'), sb, handler);
  const claimKey = calls.find((c) => c.name === "claim_idempotency_key")!.args.p_key;
  const completeKey = calls.find((c) => c.name === "complete_idempotency")!.args.p_key;
  assertEquals(completeKey, claimKey, "claim and complete must use the same storage key");
});
