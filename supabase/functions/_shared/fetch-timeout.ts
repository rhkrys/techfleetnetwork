/**
 * Audit T-H: fetch() with a hard timeout via AbortController.
 *
 * An outbound call with no timeout (e.g. a Discord webhook POST) can hang
 * indefinitely if the remote never responds. In a cron worker that blocks the
 * whole tick — a hung Discord alert stalled the email health / auto-pause cron.
 * On timeout the request is aborted and the AbortError propagates like any other
 * network failure, so existing try/catch around the call handles it unchanged.
 *
 * `timeoutMs` defaults to 10s. If the caller passes its own AbortSignal we honor
 * whichever fires first.
 */
export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = 10_000
): Promise<Response> {
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort((init.signal as AbortSignal)?.reason);
  if (init.signal) {
    if (init.signal.aborted) controller.abort(init.signal.reason);
    else init.signal.addEventListener("abort", onCallerAbort, { once: true });
  }
  const timer = setTimeout(
    () => controller.abort(new DOMException("Timeout", "TimeoutError")),
    timeoutMs
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener?.("abort", onCallerAbort);
  }
}
