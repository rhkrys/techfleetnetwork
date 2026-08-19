// Shared client for Fleety file uploads (2.2-F). One place the three chat surfaces
// (ChatPage, FleetyChatWidget, GuidanceEmbed) call to turn a picked file into extracted
// text via the fleety-extract edge function. The text is then sent to techfleet-chat as an
// `attachment`, where it is framed server-side as UNTRUSTED material (never instructions).
//
// Uploads are EPHEMERAL end to end: the file is posted, text extracted in-request, and nothing
// is persisted (no Storage bucket). Auth uses the member's session JWT (getSessionSafe) — the
// same session-bound token the chat calls use — never the static publishable key.
import { getSessionSafe } from "@/lib/auth/session-port";

export const FLEETY_EXTRACT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fleety-extract`;

/** Mirror of the server cap (fleety-extract/lib.ts MAX_UPLOAD_BYTES). Client-side precheck only —
 *  the server re-checks by magic bytes and size, so this is UX, not a security boundary. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** File picker hint. The server decides the true type by content, so this only shapes the OS
 *  dialog; a renamed file is still validated server-side. */
export const ACCEPTED_FILE_TYPES =
  ".pdf,.png,.jpg,.jpeg,.txt,.md,.markdown,.csv,.json,.js,.jsx,.ts,.tsx,.py,.html,.css,.yml,.yaml,.sql,.sh,.java,.go,.rb,.rs,.c,.cpp,.h";

export type FleetyAttachment = {
  filename: string;
  category: string;
  /** Extracted text. May be "" when `note` explains why (scanned PDF, vision quota, etc.). */
  text: string;
  /** Member-facing note (truncated / scanned / quota) shown under the chip. */
  note?: string;
  chars: number;
  truncated: boolean;
};

/** Cheap client-side gate before we bother uploading. Returns an error string or null. */
export function clientPrecheck(file: File): string | null {
  if (file.size === 0) return "That file looks empty.";
  if (file.size > MAX_UPLOAD_BYTES) return "That file is over the 10 MB limit for Fleety uploads.";
  return null;
}

/** Upload one file to fleety-extract and return its extracted text (or a note explaining why
 *  there isn't any). Throws an Error with a member-facing message on failure. */
export async function extractFile(file: File): Promise<FleetyAttachment> {
  const pre = clientPrecheck(file);
  if (pre) throw new Error(pre);

  const session = await getSessionSafe();
  const token = session?.access_token;
  if (!token) throw new Error("Please sign in again to upload a file.");

  const form = new FormData();
  form.set("file", file);

  const resp = await fetch(FLEETY_EXTRACT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const data = await resp.json().catch(() => ({}) as Record<string, unknown>);
  if (!resp.ok || !(data as { ok?: boolean }).ok) {
    const err = (data as { error?: string }).error;
    throw new Error(err || `I couldn't read that file (${resp.status}).`);
  }

  const d = data as Partial<FleetyAttachment> & { text?: string; note?: string };
  return {
    filename: typeof d.filename === "string" ? d.filename : file.name,
    category: typeof d.category === "string" ? d.category : "file",
    text: typeof d.text === "string" ? d.text : "",
    note: typeof d.note === "string" && d.note ? d.note : undefined,
    chars: typeof d.chars === "number" ? d.chars : 0,
    truncated: !!d.truncated,
  };
}

/** Shape sent to techfleet-chat in the request body. */
export function toChatAttachment(
  a: FleetyAttachment | null
): { filename: string; text: string } | undefined {
  if (!a || !a.text) return undefined;
  return { filename: a.filename, text: a.text };
}
