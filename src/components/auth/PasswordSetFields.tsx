import { useMemo, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordRequirementsList } from "@/components/registration/PasswordRequirementsList";
import { cn } from "@/lib/utils";
import { validatePasswordSet, type PasswordSetValue } from "@/lib/auth/password-set";

interface PasswordSetFieldsProps {
  value: PasswordSetValue;
  onChange: (value: PasswordSetValue) => void;
  ids?: { password?: string; confirmPassword?: string; requirements?: string };
  labels?: { password?: string; confirmPassword?: string };
  placeholders?: { password?: string; confirmPassword?: string };
  touched?: { password?: boolean; confirmPassword?: boolean };
  onBlur?: (field: keyof PasswordSetValue) => void;
  errors?: { password?: string; confirmPassword?: string };
  className?: string;
  /**
   * Email tied to the credential. When provided, a hidden
   * autoComplete="username" input is rendered so browsers + password
   * managers (Safari, Firefox, 1Password, Bitwarden, Chrome, etc.)
   * recognize this as a credential-change form and update the stored
   * password on submit. Without it the old password stays saved and the
   * member loops back into "invalid credentials" on next sign-in.
   */
  username?: string;
}

export function PasswordSetFields({
  value,
  onChange,
  ids,
  labels,
  placeholders,
  touched,
  onBlur,
  errors,
  className,
  username,
}: PasswordSetFieldsProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const passwordId = ids?.password ?? "new-password";
  const confirmId = ids?.confirmPassword ?? "confirm-new-password";
  const requirementsId = ids?.requirements ?? `${passwordId}-requirements`;
  const validation = useMemo(() => validatePasswordSet(value), [value]);
  const passwordError = errors?.password ?? (touched?.password ? validation.passwordError : "");
  const confirmError = errors?.confirmPassword ?? (touched?.confirmPassword || value.confirmPassword ? validation.confirmError : "");

  return (
    <div className={cn("space-y-4", className)} data-auth-password-set-fields>
      {username ? (
        <input
          type="email"
          name="username"
          autoComplete="username"
          value={username}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", border: 0 }}
        />
      ) : null}
      <div className="space-y-2">
        <Label htmlFor={passwordId}>{labels?.password ?? "New password"}</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id={passwordId}
            type={showPassword ? "text" : "password"}
            placeholder={placeholders?.password ?? "Create a strong password"}
            value={value.password}
            onChange={(e) => onChange({ ...value, password: e.target.value })}
            onBlur={() => onBlur?.("password")}
            className="pl-10 pr-10"
            autoComplete="new-password"
            required
            aria-required="true"
            aria-invalid={!!passwordError}
            aria-describedby={`${requirementsId}${passwordError ? ` ${passwordId}-error` : ""}`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
        <PasswordRequirementsList password={value.password} id={requirementsId} />
        {passwordError && <p id={`${passwordId}-error`} className="text-sm text-destructive" role="alert">{passwordError}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor={confirmId}>{labels?.confirmPassword ?? "Confirm new password"}</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id={confirmId}
            type={showConfirmPassword ? "text" : "password"}
            placeholder={placeholders?.confirmPassword ?? "Retype your password"}
            value={value.confirmPassword}
            onChange={(e) => onChange({ ...value, confirmPassword: e.target.value })}
            onBlur={() => onBlur?.("confirmPassword")}
            className="pl-10 pr-10"
            autoComplete="new-password"
            required
            aria-required="true"
            aria-invalid={!!confirmError}
            aria-describedby={confirmError ? `${confirmId}-error` : undefined}
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword((current) => !current)}
            className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={showConfirmPassword ? "Hide repeated password" : "Show repeated password"}
          >
            {showConfirmPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
        {confirmError && <p id={`${confirmId}-error`} className="text-sm text-destructive" role="alert" aria-live="polite">{confirmError}</p>}
      </div>
    </div>
  );
}