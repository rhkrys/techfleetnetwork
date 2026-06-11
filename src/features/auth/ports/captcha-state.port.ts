/**
 * AUTH-ENGINE — captcha state port.
 *
 * Wraps the legacy `@/lib/auth-captcha` sessionStorage counters so engine
 * code depends on the port shape instead of `src/lib`. Behaviour unchanged.
 */
export {
  getLoginCaptchaState,
  refreshLoginCaptcha,
  recordFailedLoginAttempt,
  clearLoginCaptcha,
  type LoginCaptchaState,
} from "@/lib/auth-captcha";
