#!/usr/bin/env node
// CI guard (BLOCKING): no edge function may call the RETIRED raw `enqueue_email` RPC.
//
// The raw pgmq email path (transactional_emails / bulk_emails / auth_emails) had its consumer
// retired at the July v2 cutover, so anything enqueued there is stranded. Every email enqueue must
// go through the v2 outbox: `enqueue_email_v2` directly, the shared helpers in
// `_shared/transactional-email.ts` / `_shared/email/composition.ts`, or the
// `enqueueLegacyPayloadV2` compat helper. See PR 2 and
// docs/design/email-rearchitecture-requirements.md.
//
// Scope: edge functions only (supabase/functions/**/*.ts, ALL .ts incl. tests). Historical
// migrations legitimately contain the old raw definition/calls and are not scanned.
//
// Scan/fail-closed/zero-scan/evidence owned by the shared harness (_guard.mjs).
import { runScanGuard } from "./_guard.mjs";

// Matches an actual RPC call to the raw function, not enqueue_email_v2 and not comments.
const RAW_RPC = /\brpc\(\s*["']enqueue_email["']/;

runScanGuard({
  name: "check-no-raw-email-enqueue",
  roots: ["supabase/functions"],
  include: /\.ts$/,
  exclude: /(?!)/, // never match — all .ts (incl. tests) are in scope, matching the original
  rule(src) {
    if (!RAW_RPC.test(src)) return [];
    return [
      {
        text:
          "Calls the RETIRED raw enqueue_email RPC (dead pgmq path). Use enqueue_email_v2 / the v2 " +
          "outbox (queueTransactionalEmail, composition.enqueueEmail, or enqueueLegacyPayloadV2).",
      },
    ];
  },
  summary: (n) => `${n} edge-function files`,
});
