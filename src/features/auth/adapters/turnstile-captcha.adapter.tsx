/**
 * AUTH-ENGINE — Turnstile captcha adapter.
 *
 * Wraps the existing `<TurnstileChallenge>` widget so engine/screen code never
 * touches `window.turnstile` or the Turnstile SDK directly. After Ship 5b the
 * `no-restricted-imports` guard will forbid Turnstile SDK imports outside this
 * file.
 *
 * Contract surface intentionally matches `CaptchaPort`:
 *   - `<TurnstileCaptchaAdapter onToken onError onExpire resetKey />`
 *   - Parent owns the token + reset counter (engine state).
 */
import { forwardRef, useImperativeHandle, useRef } from "react";
import { TurnstileChallenge, type TurnstileChallengeHandle } from "@/components/auth/TurnstileChallenge";
import type { CaptchaPort } from "@/features/auth/ports/captcha.port";

export interface TurnstileCaptchaAdapterProps {
  /** Bumping this remounts the widget — used after captcha_failed / expired. */
  resetKey?: number | string;
  /** Fires when Turnstile returns a fresh token. */
  onToken: (token: string) => void;
  /** Fires when Turnstile signals an error (network, blocked, internal). */
  onError?: (reason: string) => void;
  /** Fires when the token expires and needs a re-solve. */
  onExpire?: () => void;
  /** Allow callers to pass a className for layout, never for SDK config. */
  className?: string;
}

/**
 * `CaptchaPort`-compatible imperative handle. Engines call `.reset()` /
 * `.getFreshToken()` without knowing the underlying widget.
 */
export const TurnstileCaptchaAdapter = forwardRef<CaptchaPort, TurnstileCaptchaAdapterProps>(
  function TurnstileCaptchaAdapter({ resetKey, onToken, onError, onExpire, className }, ref) {
    const widgetRef = useRef<TurnstileChallengeHandle | null>(null);
    const latestTokenRef = useRef<string>("");

    useImperativeHandle(
      ref,
      () => ({
        reset() {
          latestTokenRef.current = "";
          widgetRef.current?.reset();
        },
        async getFreshToken() {
          // Turnstile auto-solves; surface whatever the latest issued token is.
          return latestTokenRef.current || null;
        },
      }),
      [],
    );

    return (
      <TurnstileChallenge
        key={`turnstile-${resetKey ?? "0"}`}
        ref={widgetRef}
        className={className}
        onToken={(token) => {
          latestTokenRef.current = token;
          onToken(token);
        }}
        onError={(reason) => {
          latestTokenRef.current = "";
          onError?.(reason);
        }}
        onExpire={() => {
          latestTokenRef.current = "";
          onExpire?.();
        }}
      />
    );
  },
);
