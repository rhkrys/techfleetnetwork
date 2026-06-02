import { CheckCircle2 } from "lucide-react";

const passwordRequirements = [
  { label: "At least 12 characters", test: (p: string) => p.length >= 12 },
  { label: "One uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "One lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { label: "One number", test: (p: string) => /[0-9]/.test(p) },
  { label: "One special character", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

function Circle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

interface PasswordRequirementsListProps {
  password: string;
  id?: string;
}

export function PasswordRequirementsList({ password, id = "password-requirements" }: PasswordRequirementsListProps) {
  return (
    <ul id={id} className="space-y-1 text-xs" aria-label="Password requirements">
      {passwordRequirements.map(({ label, test }) => {
        const met = password.length > 0 && test(password);
        return (
          <li key={label} className={`flex items-center gap-1.5 ${met ? "text-success" : "text-muted-foreground"}`}>
            {met ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
            {label}
          </li>
        );
      })}
    </ul>
  );
}
