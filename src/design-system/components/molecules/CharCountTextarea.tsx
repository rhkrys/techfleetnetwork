/**
 * CharCountTextarea (molecule). Replaces src/components/ui/char-count-textarea.tsx.
 * Textarea with a live character counter (aria-live, so AT announces remaining).
 * The counter carries data-no-translate/translate="no" (live-region guard).
 * See docs/design/design-system/components/molecules/CharCountTextarea.md
 */
import { useState, type ChangeEvent } from "react";
import { Textarea } from "../atoms/Textarea";
import { Text } from "../atoms/Text";

export interface CharCountTextareaProps {
  maxLength?: number;
  id?: string;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  minRows?: number;
  disabled?: boolean;
  error?: boolean;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  onChange?: (event: ChangeEvent<HTMLTextAreaElement>) => void;
}

export function CharCountTextarea({
  maxLength = 5000,
  value,
  defaultValue,
  onChange,
  ...rest
}: CharCountTextareaProps) {
  const initial =
    typeof value === "string" ? value : typeof defaultValue === "string" ? defaultValue : "";
  const [count, setCount] = useState(initial.length);
  return (
    <div>
      <Textarea
        value={value}
        defaultValue={defaultValue}
        inputProps={{ maxLength }}
        onChange={(e) => {
          const el = e.target as HTMLTextAreaElement;
          setCount(el.value.length);
          onChange?.(e as ChangeEvent<HTMLTextAreaElement>);
        }}
        {...rest}
      />
      <Text
        brand="caption"
        color="muted"
        aria-live="polite"
        data-no-translate="true"
        translate="no"
        sx={{ display: "block", textAlign: "right", mt: 1 }}
      >
        {count}/{maxLength}
      </Text>
    </div>
  );
}
