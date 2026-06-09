import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { SuppressionRepo } from '../ports.ts';

export function makePgSuppressionRepo(supabase: SupabaseClient): SuppressionRepo {
  return {
    async isSuppressed(recipient: string) {
      const { data, error } = await supabase
        .from('suppressed_emails')
        .select('email')
        .eq('email', recipient.toLowerCase())
        .limit(1)
        .maybeSingle();
      if (error) {
        console.warn('suppression check failed', { error: error.message });
        return false;
      }
      return !!data;
    },
  };
}
