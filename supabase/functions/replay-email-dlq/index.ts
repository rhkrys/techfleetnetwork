// @edge-auth
// Replay email DLQ — Part 1.3 of refactor plan.
// Cron-poked every 5 min. Re-enqueues messages stranded in pgmq DLQ archives
// back onto the live lane queue, tracking a replay_generation counter in the
// message payload's metadata. After 3 replays the message is dropped and an
// admin notification is created instead.
//
// Lanes covered: auth_emails, transactional_emails, bulk_emails.
// Auth: service-role only (uses shared service-role auth helper).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/http.ts';
import { authorizeServiceRoleRequest } from '../_shared/service-role-auth.ts';

const MAX_REPLAY_GENERATION = 3;
const BATCH = 25;
const LANES = ['auth_emails', 'transactional_emails', 'bulk_emails'] as const;

type LaneName = (typeof LANES)[number];

interface PgmqMessage {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: Record<string, unknown> & { metadata?: Record<string, unknown> };
}

async function readArchive(supabase: ReturnType<typeof createClient>, lane: LaneName, limit: number) {
  // Read up to `limit` archived (DLQ) messages without removing them yet.
  const { data, error } = await supabase.rpc('pgmq_read_archive', {
    queue_name: lane,
    qty: limit,
  });
  if (error) {
    // Archive RPC may not exist in older deploys — treat as empty.
    return [] as PgmqMessage[];
  }
  return (data ?? []) as PgmqMessage[];
}

async function reEnqueue(supabase: ReturnType<typeof createClient>, lane: LaneName, payload: unknown) {
  const { error } = await supabase.rpc('enqueue_email', { queue_name: lane, payload });
  if (error) throw error;
}

async function archiveDelete(supabase: ReturnType<typeof createClient>, lane: LaneName, msgId: number) {
  await supabase.rpc('pgmq_archive_delete', { queue_name: lane, msg_id: msgId });
}

async function escalate(
  supabase: ReturnType<typeof createClient>,
  lane: LaneName,
  payload: Record<string, unknown>,
) {
  // Persist an admin notification + audit row so the failure is visible.
  await supabase.rpc('notify_admins_email_dlq_escalation', {
    p_lane: lane,
    p_template: (payload?.template_name as string) ?? null,
    p_recipient: (payload?.recipient_email as string) ?? null,
    p_payload: payload,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const auth = await authorizeServiceRoleRequest(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const summary: Record<string, { replayed: number; escalated: number; failed: number }> = {};

  for (const lane of LANES) {
    const stats = { replayed: 0, escalated: 0, failed: 0 };
    let msgs: PgmqMessage[] = [];
    try {
      msgs = await readArchive(supabase, lane, BATCH);
    } catch {
      summary[lane] = stats;
      continue;
    }
    for (const m of msgs) {
      try {
        const payload = (m.message ?? {}) as Record<string, unknown>;
        const meta = (payload.metadata as Record<string, unknown> | undefined) ?? {};
        const gen = Number(meta.replay_generation ?? 0);

        if (gen >= MAX_REPLAY_GENERATION) {
          await escalate(supabase, lane, payload);
          await archiveDelete(supabase, lane, m.msg_id);
          stats.escalated += 1;
          continue;
        }

        const nextPayload = {
          ...payload,
          metadata: { ...meta, replay_generation: gen + 1, replayed_at: new Date().toISOString() },
        };
        await reEnqueue(supabase, lane, nextPayload);
        await archiveDelete(supabase, lane, m.msg_id);
        stats.replayed += 1;
      } catch {
        stats.failed += 1;
      }
    }
    summary[lane] = stats;
  }

  return new Response(JSON.stringify({ ok: true, summary }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
