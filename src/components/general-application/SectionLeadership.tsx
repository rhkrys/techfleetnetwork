import { LongFormQuestion } from "./LongFormQuestion";
import type { AppFormData } from "@/lib/validators/general-application";

interface Props {
  form: AppFormData;
  errors: Record<string, string>;
  updateField: <K extends keyof AppFormData>(key: K, value: AppFormData[K]) => void;
}

/** Section 5: Service Leadership — four long-form questions */
export function SectionLeadership({ form, errors, updateField }: Props) {
  return (
    <div className="space-y-6">
      <LongFormQuestion
        id="sl-definition"
        label="What does service leadership mean to you?"
        value={form.service_leadership_definition}
        onChange={(v) => updateField("service_leadership_definition", v)}
        error={errors.service_leadership_definition}
        required
      />
      <LongFormQuestion
        id="sl-actions"
        label="What actions would you take to demonstrate service leadership within your project team?"
        value={form.service_leadership_actions}
        onChange={(v) => updateField("service_leadership_actions", v)}
        error={errors.service_leadership_actions}
        required
      />
      <LongFormQuestion
        id="sl-challenges"
        label="What are some challenges you might face in practicing service leadership, and how would you address them?"
        value={form.service_leadership_challenges}
        onChange={(v) => updateField("service_leadership_challenges", v)}
        error={errors.service_leadership_challenges}
        required
      />
      <LongFormQuestion
        id="sl-situation"
        label="What would you do in a situation where a person on a team is not acting as a service leader to you or to others?"
        value={form.service_leadership_situation}
        onChange={(v) => updateField("service_leadership_situation", v)}
        error={errors.service_leadership_situation}
        required
      />
    </div>
  );
}
