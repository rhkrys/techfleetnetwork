// Audit H8: the announcement email dedup key. MUST be deterministic per
// (announcement, recipient) so a retry/re-run maps to the same idempotency key
// (and email_send_log.message_id) instead of re-blasting every opted-in member.
export function announcementMessageId(announcementId: string, recipientEmail: string): string {
  return `announcement-${announcementId}-${recipientEmail}`;
}
