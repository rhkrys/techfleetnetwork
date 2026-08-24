import { Input, Label } from "@/design-system";

import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppFormData } from "@/lib/validators/general-application";

interface Props {
  form: AppFormData;
  errors: Record<string, string>;
  updateField: <K extends keyof AppFormData>(key: K, value: AppFormData[K]) => void;
}

/** Section 1: Basic Information — hours commitment, portfolio, LinkedIn */
export function SectionBasicInfo({ form, errors, updateField }: Props) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Label className="text-base font-medium">
          Tech Fleet project trainees are expected to commit 15 to 20 hours on project team
          training. This is flexible, and your team builds the schedule together based on their
          availability. Are you committed to contribute 15 to 20 hours a week during project
          training? <span className="text-destructive">*</span>
        </Label>
        <div className="flex flex-col gap-2">
          {["yes", "no", "not_sure"].map((val) => (
            <button
              key={val}
              type="button"
              onClick={() => updateField("hours_commitment", val)}
              className={cn(
                "w-full text-left p-3 rounded-lg border-2 transition-all",
                form.hours_commitment === val
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              )}
            >
              <span className="font-medium text-foreground">
                {val === "yes" ? "Yes" : val === "no" ? "No" : "I'm not sure"}
              </span>
            </button>
          ))}
        </div>
        {errors.hours_commitment && (
          <p className="text-sm text-destructive flex items-center gap-1" role="alert">
            <AlertCircle className="h-3 w-3" /> {errors.hours_commitment}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="app-portfolio">
          Portfolio URL <span className="text-xs text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="app-portfolio"
          type="url"
          value={form.portfolio_url}
          onChange={(e) => updateField("portfolio_url", e.target.value)}
          placeholder="https://yourportfolio.com"
          maxLength={500}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="app-linkedin">
          LinkedIn URL <span className="text-xs text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="app-linkedin"
          type="url"
          value={form.linkedin_url}
          onChange={(e) => updateField("linkedin_url", e.target.value)}
          placeholder="https://linkedin.com/in/yourprofile"
          maxLength={500}
        />
      </div>
    </div>
  );
}
