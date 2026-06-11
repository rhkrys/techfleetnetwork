/**
 * AUTH-ENGINE — captcha port.
 *
 * Thin contract every captcha-aware engine consumes. Today there is a single
 * implementation (Turnstile); a future provider swap is a one-file change in
 * `adapters/turnstile-captcha.adapter.tsx`.
 *
 * The port deliberately does NOT expose the raw token; engines call
 * `getFreshToken()` which the adapter resolves from its internal widget
 * state. This keeps the Vichea-style invariant — no engine code can leak a
 * stale captcha token across submits.
 */
export interface CaptchaPort {
  /** Re-render the widget with a brand-new challenge. */
  reset(): void;
  /** Resolve to a fresh token, or null if the widget is not ready. */
  getFreshToken(): Promise<string | null>;
}

/**
 * Default no-op port. The real CaptchaSlot component injects a live
 * implementation via React context once the Turnstile adapter mounts.
 *
 * Until Ship 5b wires the adapter, engines continue to read `captchaToken`
 * from their existing state. This file exists today to satisfy the
 * architecture-skeleton receipt for Ship 6.
 */
export const noopCaptchaPort: CaptchaPort = {
  reset() { /* noop */ },
  async getFreshToken() { return null; },
};
