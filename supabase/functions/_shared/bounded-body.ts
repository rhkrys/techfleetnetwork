// Audit T-C: trusting Content-Length before buffering lets a caller omit or
// understate the header and stream an arbitrarily large body into
// req.text()/req.json() (memory-exhaustion DoS on public endpoints). This reader
// enforces the byte cap WHILE streaming, independent of Content-Length.
export class BodyTooLargeError extends Error {
  readonly maxBytes: number;
  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "BodyTooLargeError";
    this.maxBytes = maxBytes;
  }
}

/** Read the request body as text, aborting as soon as maxBytes is exceeded. */
export async function readBoundedText(req: Request, maxBytes: number): Promise<string> {
  // Fast path: an honest, oversized Content-Length is rejected before reading.
  const declared = Number.parseInt(req.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BodyTooLargeError(maxBytes);
  }

  if (!req.body) {
    const text = await req.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new BodyTooLargeError(maxBytes);
    }
    return text;
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            /* stream already closing */
          }
          throw new BodyTooLargeError(maxBytes);
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** Read + JSON-parse the body under a byte cap. Throws BodyTooLargeError on cap,
 *  SyntaxError on invalid JSON. */
export async function readBoundedJson<T = unknown>(req: Request, maxBytes: number): Promise<T> {
  const text = await readBoundedText(req, maxBytes);
  return JSON.parse(text) as T;
}
