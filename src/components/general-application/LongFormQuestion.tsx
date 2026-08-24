import { Label, Textarea } from "@/design-system";

import { AlertCircle } from "lucide-react";

interface LongFormQuestionProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  required?: boolean;
}

/** Reusable long-form text question with character count and validation */
export function LongFormQuestion({
  id,
  label,
  value,
  onChange,
  error,
  required,
}: LongFormQuestionProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-base font-semibold leading-relaxed">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[120px] resize-y"
        maxLength={5000}
        aria-invalid={!!error}
        aria-describedby={`${id}-count`}
      />
      <p id={`${id}-count`} className="text-xs text-muted-foreground text-right">
        {value.length} / 5,000
      </p>
      {error && (
        <p className="text-sm text-destructive flex items-center gap-1" role="alert">
          <AlertCircle className="h-3 w-3" /> {error}
        </p>
      )}
    </div>
  );
}
