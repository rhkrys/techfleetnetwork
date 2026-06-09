import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { EventSink } from '../ports.ts';

export function makeOpsEventSink(supabase: SupabaseClient, source = 'email-v2'): EventSink {
  return {
    async emit(kind, payload, severity = 'info') {
      try {
        await supabase.from('ops_events').insert({
          kind, severity, source, payload, occurred_at: new Date().toISOString(),
        });
      } catch (e) { console.warn('ops_events emit failed', { kind, err: String(e) }); }
    },
  };
}
