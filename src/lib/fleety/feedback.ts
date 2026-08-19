// Shared client for Fleety answer feedback (👍/👎 + reason chips). One place all three chat
// surfaces (ChatPage, FleetyChatWidget, GuidanceEmbed) call, so every surface feeds the SAME
// live learning loop: a rating is keyed to the turn id (X-Fleety-Turn-Id) and written to
// fleety_message_feedback. Downstream, techfleet-chat reads these signals at answer time —
// thumbs-up answers become few-shot exemplars + boost canned-answer ranking, thumbs-down
// canned answers are auto-suppressed nightly (fleety-learning-digest). RLS: a member may only
// write their own row (auth.uid() = user_id), so this is called with the member's session.
import { supabase } from "@/integrations/supabase/client";

/** Reason chips shown after a thumbs-down. Kept in one place so all surfaces match and the set
 *  the learning digest clusters on never drifts between surfaces. */
export const FEEDBACK_REASONS = [
  "Too vague",
  "Wrong project",
  "Missing steps",
  "Needed a template",
  "Outdated info",
] as const;

export type FeedbackRating = 1 | -1;

/** Upsert the member's rating for one answer turn. Idempotent on (turn_id, user_id). */
export async function submitRating(
  turnId: string,
  userId: string,
  rating: FeedbackRating
): Promise<{ ok: boolean }> {
  if (!turnId || !userId) return { ok: false };
  const { error } = await supabase
    .from("fleety_message_feedback")
    .upsert({ turn_id: turnId, user_id: userId, rating }, { onConflict: "turn_id,user_id" });
  return { ok: !error };
}

/** Update the reason chips on an existing (downvoted) feedback row. */
export async function submitReasons(
  turnId: string,
  userId: string,
  reasons: string[]
): Promise<{ ok: boolean }> {
  if (!turnId || !userId) return { ok: false };
  const { error } = await supabase
    .from("fleety_message_feedback")
    .update({ reasons })
    .eq("turn_id", turnId)
    .eq("user_id", userId);
  return { ok: !error };
}
