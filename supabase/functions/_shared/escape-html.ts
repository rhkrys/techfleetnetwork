// Audit T-D: escape user/teacher-controlled text before it is interpolated into
// a notification title / body_html or an HTML email field. The notification
// render path trusts stored HTML, so every writer MUST escape at the insert
// boundary. Shared so new writers can't miss it (see the mark-interview-scheduled
// title regression, where the body was escaped but the title was not).
export function escapeHtml(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
