/**
 * AUTH-ENGINE — domain constants.
 *
 * Pure string constants that survive Ship 5 (when `@/services/auth.service`
 * is deleted). Engines and screens import from here instead of pulling the
 * whole AuthService module just for two error codes.
 */
export const GOOGLE_ONLY_ACCOUNT_CODE = "GOOGLE_ONLY_ACCOUNT";
export const GOOGLE_ONLY_ACCOUNT_MESSAGE =
  "This account uses Google sign-in. Use Google to continue; password reset is not available for this account.";
