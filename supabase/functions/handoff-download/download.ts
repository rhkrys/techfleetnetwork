// PURE helpers for hand-off output downloads (Phase B3). No I/O -> unit-tested offline.
export const SIGNED_URL_TTL_SECONDS = 60; // short-lived; a fresh URL is minted per request

export type DownloadReq = { ok: true; outputFileId: string } | { ok: false; error: string };

export function parseDownloadBody(body: unknown): DownloadReq {
  const id = (body as { output_file_id?: unknown } | null)?.output_file_id;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) {
    return { ok: false, error: "invalid output_file_id" };
  }
  return { ok: true, outputFileId: id };
}
