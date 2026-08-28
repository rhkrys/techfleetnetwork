// @edge-auth
//
// Scheduled reaper for the private `class-module-files` bucket. Deleting a
// module/section/class cascade-removes the class_module_attachments ROWS but not
// the stored blobs (a pure-SQL cron can't delete objects), so this cron-poked
// worker fetches the orphan list (SQL diff via list_class_module_file_orphans)
// and removes the blobs via the Storage API.
//
// Safety: DRY-RUN by default — it only DELETES when CURRICULUM_ORPHAN_REAP_APPLY
// is 'true', so the first deploy just logs counts until you enable it. A 48h
// grace window (in the SQL fn) protects in-flight uploads, and isReapableKey()
// refuses to touch any key outside the class/{id}/item/{id}/… shape.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

import { corsHeaders } from "../_shared/http.ts";
import { authorizeServiceRoleRequest } from "../_shared/service-role-auth.ts";
import { chunk, isReapableKey } from "./lib.ts";
import { withAuditWrapper } from "../_shared/audit.ts";

const BUCKET = "class-module-files";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(
  withAuditWrapper("reap-class-module-orphans", async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const auth = authorizeServiceRoleRequest(req);
    if (!auth.ok) return json(auth.status, { error: auth.error });
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json(500, { error: "Server configuration error" });

    const supabase = createClient(url, key);
    // Deletes only when explicitly enabled; otherwise observe-only (log the count).
    const apply = Deno.env.get("CURRICULUM_ORPHAN_REAP_APPLY") === "true";

    const { data, error } = await supabase.rpc("list_class_module_file_orphans", {
      _older_than: "48 hours",
    });
    if (error) return json(500, { error: error.message });

    const names = ((data ?? []) as Array<{ name: string }>)
      .map((r) => r.name)
      .filter(isReapableKey); // never remove keys outside the expected shape

    let removed = 0;
    const errors: string[] = [];
    if (apply && names.length > 0) {
      for (const batch of chunk(names, 100)) {
        const { error: rmErr } = await supabase.storage.from(BUCKET).remove(batch);
        if (rmErr) errors.push(rmErr.message);
        else removed += batch.length;
      }
    }

    const summary = {
      ok: true,
      dryRun: !apply,
      bucket: BUCKET,
      orphanCount: names.length,
      removed,
      errors,
    };
    // Structured log → shows up as a golden-signal metric (orphan growth / reaped).
    console.log(JSON.stringify({ evt: "class_module_orphan_reap", ...summary }));
    return json(200, summary);
  })
);
