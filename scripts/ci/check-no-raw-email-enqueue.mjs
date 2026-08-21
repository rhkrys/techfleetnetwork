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
// Scope: edge functions only (supabase/functions/**/*.ts). Historical migrations legitimately
// contain the old raw definition/calls and are not scanned.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const DIR = join(ROOT, "supabase", "functions");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

// Matches an actual RPC call to the raw function, not enqueue_email_v2 and not comments.
const RAW_RPC = /\brpc\(\s*["']enqueue_email["']/;

let violations = 0;
for (const f of walk(DIR)) {
  const src = readFileSync(f, "utf8");
  if (RAW_RPC.test(src)) {
    console.error(
      `✖ ${relative(ROOT, f).replace(/\\/g, "/")}\n` +
        `   Calls the RETIRED raw enqueue_email RPC (dead pgmq path). Use enqueue_email_v2 / the v2\n` +
        `   outbox (queueTransactionalEmail, composition.enqueueEmail, or enqueueLegacyPayloadV2).`
    );
    violations++;
  }
}

if (violations > 0) {
  console.error(`\n${violations} raw enqueue_email caller(s) found.`);
  process.exit(1);
}
console.log(
  "✓ check-no-raw-email-enqueue: no edge function calls the retired raw enqueue_email RPC."
);
