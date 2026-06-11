/**
 * AUTH-ENGINE — device-lockout port.
 *
 * Wraps the legacy `@/lib/auth-lockout` sessionStorage counters so engine
 * code depends on the port shape instead of a `src/lib` module. Behaviour
 * unchanged; once Ship 5 lands the legacy file is deleted and this port
 * becomes the single owner of device-lockout state.
 */
export {
  getAuthLockoutState,
  recordInvalidAuthAttempt,
  clearAuthLockout,
  formatAuthLockoutMessage,
  maybeAutoHealAuthLockout,
  resetAuthLockoutForEmailChange,
  type AuthLockoutState,
} from "@/lib/auth-lockout";
