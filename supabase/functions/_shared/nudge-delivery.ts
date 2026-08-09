/**
 * T-F (reliability / silent loss): a one-shot reminder or debounce-suppression
 * timestamp — e.g. `general_applications.resume_reminder_sent_at` (fires once
 * ever) or `user_quest_selections.last_nudged_at` (suppresses for 7 days) — must
 * only be advanced when the message actually reached the user on at least one
 * channel.
 *
 * The bug this guards: the cron senders stamped the timestamp unconditionally.
 * `supabase.functions.invoke('send-transactional-email', …)` resolves with
 * `{ error }` on a non-2xx — it does NOT throw — so a `try/catch` around it never
 * fired, and a failed email (or a failed notification insert) still advanced the
 * gate. Result: the reminder was permanently lost, or the nudge was suppressed
 * for the whole debounce window despite never being delivered.
 *
 * Delivery counts if the in-app notification was written OR an email was both
 * attempted (recipient hadn't opted out) and sent without error.
 */
export function wasDelivered(opts: {
  inAppOk: boolean;
  emailAttempted: boolean;
  emailOk: boolean;
}): boolean {
  return opts.inAppOk || (opts.emailAttempted && opts.emailOk);
}
