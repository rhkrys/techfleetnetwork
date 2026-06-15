/**
 * AUTH-ARCH-CUTOVER-009 — identity-hint service.
 * Replaces legacy AuthService.checkAccountIdentity. Fail-open: if the edge
 * function rejects we return the most permissive shape so password reset still
 * proceeds (anti-enumeration preserved).
 */
import { supabase } from "@/integrations/supabase/client";
import { emailInputSchema } from "@/lib/validators/auth";

export async function checkAccountIdentity(
  email: string,
  captchaToken?: string,
): Promise<{ has_password: boolean; has_google: boolean }> {
  const parsedEmail = emailInputSchema.safeParse(email);
  if (!parsedEmail.success) return { has_password: false, has_google: false };
  try {
    const body: Record<string, string> = { email: parsedEmail.data };
    const safeCaptchaToken = captchaToken?.trim();
    if (safeCaptchaToken) body.captchaToken = safeCaptchaToken;
    const { data, error } = await supabase.functions.invoke("check-account-identity", { body });
    if (error || !data) return { has_password: true, has_google: false };
    const r = data as { has_password?: boolean; has_google?: boolean };
    return { has_password: r.has_password === true, has_google: r.has_google === true };
  } catch {
    return { has_password: true, has_google: false };
  }
}
