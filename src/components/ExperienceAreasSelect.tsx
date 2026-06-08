import { useCallback, useMemo } from "react";
import { MultiSelect, type MultiSelectOption } from "@/components/ui/multi-select";
import { EXPERIENCE_AREAS } from "@/lib/application-options";
import { MAX_EXPERIENCE_AREAS } from "@/lib/validators/profile";

const NOT_SURE = "I'm not sure yet";

/**
 * Experience Areas multi-select with mutual exclusion + hard cap:
 * - "I'm not sure yet" is listed first, rest alphabetical.
 * - When "I'm not sure yet" is selected, all others are disabled/cleared.
 * - When any other option is selected, "I'm not sure yet" is removed.
 * - Caps at MAX_EXPERIENCE_AREAS (= schema cap) — unselected options grey
 *   out once the cap is reached so the server-side `validation_rejected`
 *   event class can never fire.
 */
interface ExperienceAreasSelectProps {
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
}

export function ExperienceAreasSelect({
  selected,
  onChange,
  placeholder = "Search and select areas...",
  disabled,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
}: ExperienceAreasSelectProps) {
  const notSureSelected = selected.includes(NOT_SURE);
  const atCap = selected.length >= MAX_EXPERIENCE_AREAS && !notSureSelected;

  const options: MultiSelectOption[] = useMemo(() => {
    const sorted = EXPERIENCE_AREAS.filter((e) => e !== NOT_SURE).slice().sort((a, b) => a.localeCompare(b));
    return [
      { value: NOT_SURE, label: NOT_SURE, disabled: selected.length > 0 && !notSureSelected },
      ...sorted.map((e) => ({
        value: e,
        label: e,
        // Disable if "not sure" is on, OR cap reached AND this option isn't already chosen.
        disabled: notSureSelected || (atCap && !selected.includes(e)),
      })),
    ] as MultiSelectOption[];
  }, [notSureSelected, atCap, selected]);

  const handleChange = useCallback(
    (newSelected: string[]) => {
      const wasNotSure = selected.includes(NOT_SURE);
      const isNotSure = newSelected.includes(NOT_SURE);

      if (isNotSure && !wasNotSure) {
        onChange([NOT_SURE]);
        return;
      }
      if (isNotSure && newSelected.length > 1) {
        onChange(newSelected.filter((v) => v !== NOT_SURE));
        return;
      }
      // Hard client cap — never send more than the schema accepts.
      if (newSelected.length > MAX_EXPERIENCE_AREAS) {
        onChange(newSelected.slice(0, MAX_EXPERIENCE_AREAS));
        return;
      }
      onChange(newSelected);
    },
    [selected, onChange]
  );

  return (
    <div className="space-y-1">
      <MultiSelect
        options={options}
        selected={selected}
        onChange={handleChange}
        placeholder={notSureSelected ? "I'm not sure yet" : placeholder}
        disabled={disabled}
        aria-label={ariaLabel || "Experience areas"}
        aria-invalid={ariaInvalid}
      />
      <p
        className="text-xs text-muted-foreground"
        aria-live="polite"
        data-testid="experience-areas-counter"
      >
        {selected.length} of {MAX_EXPERIENCE_AREAS} selected
        {atCap && " — maximum reached"}
      </p>
    </div>
  );
}
