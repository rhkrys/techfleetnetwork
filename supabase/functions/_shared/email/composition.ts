// Composition root — single place where the layers are wired. Edge fns import from here.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { makePgOutboxRepo } from './infrastructure/pg-outbox-repo.ts';
import { makePgSuppressionRepo } from './infrastructure/pg-suppression-repo.ts';
import { makePgPolicyRepo } from './infrastructure/pg-policy-repo.ts';
import { makeLovableEmailsProvider } from './infrastructure/lovable-emails-provider.ts';
import { makeSesEmailsProvider } from './infrastructure/ses-provider.ts';
import { makeOpsEventSink } from './infrastructure/ops-event-sink.ts';
import { makeEnqueueEmail } from './application/enqueue-email.ts';
import { makeDispatchDue } from './application/dispatch-due.ts';
import { LANE_BITMASK, type Lane } from './domain/types.ts';

export function buildEmailContainer(client?: SupabaseClient) {
  const supabase = client ?? createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const outbox = makePgOutboxRepo(supabase);
  const suppression = makePgSuppressionRepo(supabase);
  const policy = makePgPolicyRepo(supabase);
  // Provider selection (reversible): EMAIL_PROVIDER=ses routes sends through
  // Amazon SES SMTP; anything else (or unset) keeps the legacy Lovable adapter.
  // Default stays Lovable so deploying this is a no-op until SES is configured.
  const provider = (Deno.env.get('EMAIL_PROVIDER') ?? 'lovable').toLowerCase() === 'ses'
    ? makeSesEmailsProvider()
    : makeLovableEmailsProvider();
  const events = makeOpsEventSink(supabase);
  const logger = { info: console.log, warn: console.warn, error: console.error };
  const clock = { now: () => new Date() };

  const enqueueEmail = makeEnqueueEmail({
    outbox, suppression, events,
    randomMessageId: () => crypto.randomUUID(),
  });
  const dispatchDue = makeDispatchDue({ outbox, provider, policy, events, logger, clock });

  return { supabase, outbox, suppression, policy, provider, events, enqueueEmail, dispatchDue };
}

/** Per-lane feature flag check from email_send_state.pipeline_v2_lanes_bitmask. */
export async function isV2Enabled(supabase: SupabaseClient, lane: Lane): Promise<boolean> {
  try {
    const { data } = await supabase.from('email_send_state')
      .select('pipeline_v2_lanes_bitmask').eq('id', 1).maybeSingle();
    const mask = (data?.pipeline_v2_lanes_bitmask ?? 0) as number;
    return (mask & LANE_BITMASK[lane]) !== 0;
  } catch { return false; }
}
