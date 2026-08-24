import { Label } from "@/design-system";

import { RichTextEditor } from "@/components/RichTextEditor";

/**
 * Presentational wrapper for a labeled rich-text editor section in a form.
 *
 * Pure refactor target — extracted from ClassFormPage/CohortFormPage where
 * the same Label + RichTextEditor + error-text pattern repeats per section.
 * DOM output is intentionally identical to the previous inline blocks so it
 * is a drop-in replacement.
 */
export interface RichTextSectionProps {
  id: string;
  label: string;
  placeholder?: string;
  value: string;
  onChange: (html: string) => void;
  error?: string;
}

export function RichTextSection({
  id,
  label,
  placeholder,
  value,
  onChange,
  error,
}: RichTextSectionProps) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div id={id}>
        <RichTextEditor content={value} onChange={onChange} placeholder={placeholder} />
      </div>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}
