import { passwordSchema } from "@/lib/validators/auth";

export interface PasswordSetValue {
  password: string;
  confirmPassword: string;
}

export interface PasswordSetValidation {
  passwordError: string;
  confirmError: string;
  isValid: boolean;
}

export function validatePasswordSet(value: PasswordSetValue): PasswordSetValidation {
  const parsed = passwordSchema.safeParse(value.password);
  const passwordError = parsed.success ? "" : parsed.error.issues[0]?.message ?? "Enter a stronger password.";
  let confirmError = "";
  if (!value.confirmPassword) confirmError = "Please confirm your password.";
  else if (value.password !== value.confirmPassword) confirmError = "Those passwords do not match yet. Retype the second one.";
  return { passwordError, confirmError, isValid: !passwordError && !confirmError };
}