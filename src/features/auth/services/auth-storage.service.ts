import { AUTH_STORAGE_KEYS } from "../domain/auth-storage-keys";

/**
 * auth-storage.service — the SINGLE module allowed to read or write any of
 * the keys declared in `auth-storage-keys.ts`. Phase 2 ships the read/write
 * primitives; Phase 5 ESLint rule `no-auth-storage-literals` will then ban
 * those literals from every other file.
 *
 * Storage backends are intentionally narrow:
 *   - sessionStorage for per-tab values (session marker, machine snapshot)
 *   - localStorage for cross-tab values (last activity, captcha verified,
 *     reset attempts, login lockout)
 *
 * Supabase token bag (`sb-*-auth-token`) is owned by GoTrue and must NOT
 * be touched here — `purgeOnSignOut` clears it via the shared purger to
 * keep one source of truth.
 */

type Backend = "session" | "local";

function backend(b: Backend): Storage | null {
  try {
    return b === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function readString(b: Backend, key: string): string | null {
  return backend(b)?.getItem(key) ?? null;
}

function writeString(b: Backend, key: string, value: string): void {
  try { backend(b)?.setItem(key, value); } catch { /* quota / private mode */ }
}

function remove(b: Backend, key: string): void {
  try { backend(b)?.removeItem(key); } catch { /* noop */ }
}

// ---------------- Per-tab session marker ----------------

export function readSessionStartedAtRaw(): string | null {
  return readString("session", AUTH_STORAGE_KEYS.sessionStartedAt);
}

export function writeSessionStartedAtRaw(json: string): void {
  writeString("session", AUTH_STORAGE_KEYS.sessionStartedAt, json);
}

export function clearSessionStartedAt(): void {
  remove("session", AUTH_STORAGE_KEYS.sessionStartedAt);
}

// ---------------- Cross-tab activity timestamp ----------------

export function readLastActivityAt(): number {
  const v = readString("local", AUTH_STORAGE_KEYS.lastActivityAt);
  const n = v ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function writeLastActivityAt(ms: number = Date.now()): void {
  writeString("local", AUTH_STORAGE_KEYS.lastActivityAt, String(ms));
}

// ---------------- Reset attempt counter ----------------

export function readResetAttempts(): number {
  const v = readString("local", AUTH_STORAGE_KEYS.resetAttempts);
  const n = v ? Number(v) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function bumpResetAttempts(): number {
  const next = readResetAttempts() + 1;
  writeString("local", AUTH_STORAGE_KEYS.resetAttempts, String(next));
  return next;
}

export function clearResetAttempts(): void {
  remove("local", AUTH_STORAGE_KEYS.resetAttempts);
}

// ---------------- Per-device login lockout ----------------

export interface LoginLockoutSnapshot {
  attempts: number;
  lockedUntilMs: number;
}

export function readLoginLockout(): LoginLockoutSnapshot {
  const v = readString("local", AUTH_STORAGE_KEYS.loginLockout);
  if (!v) return { attempts: 0, lockedUntilMs: 0 };
  try {
    const obj = JSON.parse(v) as Partial<LoginLockoutSnapshot>;
    return {
      attempts: Number(obj?.attempts) || 0,
      lockedUntilMs: Number(obj?.lockedUntilMs) || 0,
    };
  } catch {
    return { attempts: 0, lockedUntilMs: 0 };
  }
}

export function writeLoginLockout(s: LoginLockoutSnapshot): void {
  writeString("local", AUTH_STORAGE_KEYS.loginLockout, JSON.stringify(s));
}

export function clearLoginLockout(): void {
  remove("local", AUTH_STORAGE_KEYS.loginLockout);
}

// ---------------- Captcha verified-at (cross-tab) ----------------

export function readCaptchaVerifiedAt(): number {
  const v = readString("local", AUTH_STORAGE_KEYS.captchaVerifiedAt);
  const n = v ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
}

export function writeCaptchaVerifiedAt(ms: number = Date.now()): void {
  writeString("local", AUTH_STORAGE_KEYS.captchaVerifiedAt, String(ms));
}

export function clearCaptchaVerifiedAt(): void {
  remove("local", AUTH_STORAGE_KEYS.captchaVerifiedAt);
}

// ---------------- Correlation id (per submit) ----------------

export function readCorrelationId(): string | null {
  return readString("session", AUTH_STORAGE_KEYS.correlationId);
}

export function writeCorrelationId(id: string): void {
  writeString("session", AUTH_STORAGE_KEYS.correlationId, id);
}

export function clearCorrelationId(): void {
  remove("session", AUTH_STORAGE_KEYS.correlationId);
}

/**
 * Purge every auth-owned storage key. Called on sign-out and on any
 * detected wedge/recovery path. Does NOT touch the Supabase token bag —
 * that is the shared purger's job (delegated by the flow layer).
 */
export function purgeAuthOwnedStorage(): void {
  clearSessionStartedAt();
  clearResetAttempts();
  clearLoginLockout();
  clearCaptchaVerifiedAt();
  clearCorrelationId();
}
