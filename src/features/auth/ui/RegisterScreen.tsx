/**
 * RegisterScreen — presentation only. State lives in useRegisterEngine.
 * Visual contract preserved 1:1 from legacy RegisterPage.
 */
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Mail, CheckCircle2, User, Cake, ShieldAlert } from "lucide-react";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { PasswordSetFields } from "@/components/auth/PasswordSetFields";
import { ValidatedField } from "@/components/ui/validated-field";
import { validationBorderClass, getFieldValidationState } from "@/lib/form-validation";
import { TurnstileChallenge } from "@/components/auth/TurnstileChallenge";
import { PolicyLinksInline } from "@/components/PolicyLinksInline";
import { recordPolicyAcknowledgment } from "@/lib/policies";
import { useRegisterEngine, ageInYears, GUARDIAN_MIN_AGE } from "@/features/auth/engine/use-register-engine";
import techFleetLogo from "@/assets/tech-fleet-logo.svg";

export default function RegisterScreen() {
  const e = useRegisterEngine();
  const vs = (field: string, value: string | boolean) => getFieldValidationState(e.errors[field], value, !!e.touched[field]);
  const bc = (field: string, value: string | boolean) => validationBorderClass(vs(field, value));

  if (e.submitted) {
    return (
      <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center animate-fade-in card-elevated p-8">
          <CheckCircle2 className="h-16 w-16 text-success mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Check your email</h1>
          <p className="text-muted-foreground leading-relaxed">
            If <strong className="text-foreground">{e.email}</strong> needs verification, a confirmation link is on the way. Existing verified accounts will not receive another signup email.
          </p>
          {e.resendMessage && (
            <p className={`mt-4 rounded-md p-3 text-sm ${e.resendStatus === "success" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`} role="status" aria-live="polite">
              {e.resendMessage}
            </p>
          )}
          <div className="mt-6 grid gap-3">
            <TurnstileChallenge action="signup_confirmation_resend" onTokenChange={e.setResendCaptchaToken} failureCount={e.resendCaptchaFailureCount} />
            <Button type="button" onClick={e.handleResendConfirmation} disabled={e.resending}>
              {e.resending ? "Sending verification…" : "Resend verification email"}
            </Button>
            <Link to="/login"><Button variant="outline" className="w-full">Go to sign in</Button></Link>
            <Link to="/forgot-password" className="text-sm text-primary-text font-medium hover:underline">Forgot your password?</Link>
          </div>
        </div>
      </div>
    );
  }

  const age = e.dobParts ? ageInYears(e.dobParts.birthYear, e.dobParts.birthMonth, e.dobParts.birthDay) : null;
  const needsGuardian = age !== null && age >= GUARDIAN_MIN_AGE && age < 18;

  return (
    <div className="min-h-[calc(100dvh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-8 animate-fade-in">
        <div className="text-center">
          <img src={techFleetLogo} alt="" className="h-12 w-12 mx-auto mb-4 dark:invert" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-foreground">Join Tech Fleet</h1>
          <p className="text-muted-foreground mt-1">Create your account and start your journey</p>
        </div>

        <div className="card-elevated p-6 sm:p-8">
          {e.existingAccountEmail && (
            <div className="mb-4 p-4 rounded-md border border-primary/30 bg-primary/5 text-sm" role="status" aria-live="polite">
              <h2 className="font-semibold text-foreground mb-1">You already have an account</h2>
              <p className="text-muted-foreground mb-3">
                An account already exists for <span className="font-medium text-foreground break-all">{e.existingAccountEmail}</span>. Sign in to continue, or reset your password if you've forgotten it.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button asChild className="w-full sm:w-auto">
                  <Link to={`/login?email=${encodeURIComponent(e.existingAccountEmail)}${e.redirectParam ? `&redirect=${encodeURIComponent(e.redirectParam)}` : ""}`}>
                    Sign in instead
                  </Link>
                </Button>
                <Button asChild variant="outline" className="w-full sm:w-auto">
                  <Link to={`/forgot-password?email=${encodeURIComponent(e.existingAccountEmail)}`}>
                    Reset your password
                  </Link>
                </Button>
                <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={e.clearExistingAccount}>
                  Use a different email
                </Button>
              </div>
            </div>
          )}
          {e.authError && !e.existingAccountEmail && (
            <div className="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm" role="alert">{e.authError}</div>
          )}

          <GoogleSignInButton
            label="Sign up with Google"
            redirectTo={e.redirectParam || "/dashboard"}
            onBeforeSubmit={() => { recordPolicyAcknowledgment("google-oauth"); return true; }}
          />
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
            By continuing with Google, you confirm that you have read and agree to the <PolicyLinksInline />.
          </p>

          <div className="mt-4 relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t" /></div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or continue with email</span>
            </div>
          </div>

          <form onSubmit={e.handleSubmit} className="space-y-5 mt-4" noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <ValidatedField id="reg-firstName" label="First name" required error={e.errors.firstName} value={e.firstName} touched={e.touched.firstName}>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <Input id="reg-firstName" type="text" placeholder="Jane" value={e.firstName} onChange={(ev) => e.setFirstName(ev.target.value)} onBlur={() => e.markTouched("firstName")} className={`pl-10 ${bc("firstName", e.firstName)}`} autoComplete="given-name" required aria-required="true" aria-invalid={!!e.errors.firstName} aria-describedby={e.errors.firstName ? "reg-firstName-error" : undefined} />
                </div>
              </ValidatedField>

              <ValidatedField id="reg-lastName" label="Last name" required error={e.errors.lastName} value={e.lastName} touched={e.touched.lastName}>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <Input id="reg-lastName" type="text" placeholder="Doe" value={e.lastName} onChange={(ev) => e.setLastName(ev.target.value)} onBlur={() => e.markTouched("lastName")} className={`pl-10 ${bc("lastName", e.lastName)}`} autoComplete="family-name" required aria-required="true" aria-invalid={!!e.errors.lastName} aria-describedby={e.errors.lastName ? "reg-lastName-error" : undefined} />
                </div>
              </ValidatedField>
            </div>

            <ValidatedField id="reg-email" label="Email address" required error={e.errors.email} value={e.email} touched={e.touched.email}>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input id="reg-email" type="email" inputMode="email" placeholder="you@example.com" value={e.email} onChange={(ev) => e.setEmail(ev.target.value)} onBlur={() => e.markTouched("email")} className={`pl-10 ${bc("email", e.email)}`} autoComplete="email" required aria-required="true" aria-invalid={!!e.errors.email} aria-describedby={e.errors.email ? "reg-email-error" : undefined} />
              </div>
            </ValidatedField>

            <PasswordSetFields
              value={{ password: e.password, confirmPassword: e.confirmPassword }}
              onChange={(next) => { e.setPassword(next.password); e.setConfirmPassword(next.confirmPassword); }}
              ids={{ password: "reg-password", confirmPassword: "reg-confirmPassword", requirements: "password-requirements" }}
              labels={{ password: "Password", confirmPassword: "Confirm password" }}
              placeholders={{ password: "Create a strong password", confirmPassword: "Re-enter your password" }}
              touched={{ password: e.touched.password, confirmPassword: e.touched.confirmPassword }}
              onBlur={(field) => e.markTouched(field)}
              errors={{ password: e.errors.password, confirmPassword: e.errors.confirmPassword }}
            />

            <ValidatedField id="reg-dob" label="Date of birth" required error={e.errors.dob} value={e.dob} touched={e.touched.dob}>
              <div className="relative">
                <Cake className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <Input id="reg-dob" type="date" value={e.dob} onChange={(ev) => e.setDob(ev.target.value)} onBlur={() => e.markTouched("dob")} max={new Date().toISOString().slice(0, 10)} min="1900-01-01" className={`pl-10 ${bc("dob", e.dob)}`} autoComplete="bday" required aria-required="true" aria-invalid={!!e.errors.dob} aria-describedby="dob-help" />
              </div>
              <p id="dob-help" className="text-xs text-muted-foreground mt-1">
                Tech Fleet is for ages 18+. Users 13–17 may join with a parent or guardian's consent (T&amp;C §2). We store the year only.
              </p>
            </ValidatedField>

            {needsGuardian && (
              <ValidatedField id="reg-guardian" label="Parent or guardian email" required error={e.errors.guardianEmail} value={e.guardianEmail} touched={e.touched.guardianEmail}>
                <div className="relative">
                  <ShieldAlert className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <Input id="reg-guardian" type="email" placeholder="parent@example.com" value={e.guardianEmail} onChange={(ev) => e.setGuardianEmail(ev.target.value)} onBlur={() => e.markTouched("guardianEmail")} className={`pl-10 ${bc("guardianEmail", e.guardianEmail)}`} autoComplete="email" required aria-required="true" />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  We will email your parent or guardian to confirm consent before your account is fully activated.
                </p>
              </ValidatedField>
            )}

            <div className="flex items-start gap-2">
              <Checkbox id="comms" checked={e.electronicCommsConsent} onCheckedChange={(checked) => { e.setElectronicCommsConsent(checked === true); e.markTouched("electronicCommsConsent"); }} aria-required="true" aria-invalid={!!e.errors.electronicCommsConsent} />
              <Label htmlFor="comms" className="text-sm leading-relaxed">
                I agree to receive notices, account alerts, and other electronic communications by email (ToU §18).
              </Label>
            </div>
            {e.errors.electronicCommsConsent && <p className="text-sm text-destructive flex items-center gap-1" role="alert"><span className="h-3 w-3 shrink-0">⚠</span> {e.errors.electronicCommsConsent}</p>}

            <div className="flex items-start gap-2">
              <Checkbox id="terms" checked={e.agreedToTerms} onCheckedChange={(checked) => { e.setAgreedToTerms(checked === true); e.markTouched("agreedToTerms"); }} aria-required="true" aria-invalid={!!e.errors.agreedToTerms} />
              <Label htmlFor="terms" className="text-sm leading-relaxed">
                I have read and agree to the <PolicyLinksInline />.
              </Label>
            </div>
            {e.errors.agreedToTerms && <p className="text-sm text-destructive flex items-center gap-1" role="alert"><span className="h-3 w-3 shrink-0">⚠</span> {e.errors.agreedToTerms}</p>}

            <TurnstileChallenge action="register" onTokenChange={e.setCaptchaToken} failureCount={e.captchaFailureCount} />

            <Button type="submit" className="w-full" disabled={e.loading || e.lockoutState.locked} aria-describedby={e.lockoutState.locked ? "register-lockout-status" : undefined}>
              {e.loading ? "Creating account…" : e.lockoutState.locked ? `Try again in ${e.lockoutState.remainingSeconds}s` : "Create account"}
            </Button>
            {e.lockoutState.locked && <p id="register-lockout-status" className="text-sm text-muted-foreground text-center" aria-live="polite">{e.formatLockoutMessage(e.lockoutState.remainingSeconds)}</p>}
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to={e.redirectParam ? `/login?redirect=${encodeURIComponent(e.redirectParam)}` : "/login"} className="text-primary-text font-medium hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
