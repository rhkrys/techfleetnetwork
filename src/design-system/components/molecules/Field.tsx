/**
 * Field (molecule) — label + control + error/helper text.
 * Presentational glue used by the RHF adapters and standalone forms.
 * Replaces the shadcn form.tsx FormItem/FormLabel/FormMessage scaffolding.
 *
 * Accessibility (universal-accessibility-wcag):
 * - The message is linked to the control via `aria-describedby` (WCAG 1.3.1) so
 *   screen readers announce the hint/error with the field.
 * - Errors render in text with an assertive alert live region (WCAG 3.3.1 / 4.1.3)
 *   — announced, never conveyed by color alone (1.4.1). Required is marked with
 *   text, not color. The message carries data-no-translate/translate="no" so the
 *   runtime DOM translator does not mutate the live region and race React.
 * See docs/design/design-system/components/molecules/Field.md
 */
import { Children, cloneElement, isValidElement, useId, type ReactNode } from "react";
import { Label } from "../atoms/Label";
import { Text } from "../atoms/Text";

export interface FieldProps {
  label?: ReactNode;
  htmlFor?: string;
  required?: boolean;
  /** Error message — takes precedence over helperText and colors the message. */
  error?: string;
  helperText?: ReactNode;
  children: ReactNode;
}

export function Field({ label, htmlFor, required, error, helperText, children }: FieldProps) {
  const message = error ?? helperText;
  const msgId = useId();
  const describedBy = message != null ? msgId : undefined;

  // Link the message to the single control via aria-describedby (and aria-invalid
  // when in error) so assistive tech ties them together.
  const control =
    describedBy != null && Children.count(children) === 1 && isValidElement(children)
      ? cloneElement(children as React.ReactElement<Record<string, unknown>>, {
          "aria-describedby": [
            (children as React.ReactElement<Record<string, unknown>>).props["aria-describedby"],
            describedBy,
          ]
            .filter(Boolean)
            .join(" "),
          ...(error ? { "aria-invalid": true } : null),
        })
      : children;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      {label != null && (
        <Label htmlFor={htmlFor}>
          {label}
          {required ? <span aria-hidden="true"> *</span> : null}
          {required ? <span className="sr-only"> (required)</span> : null}
        </Label>
      )}
      {control}
      {message != null && (
        <Text
          id={msgId}
          brand="caption"
          role={error ? "alert" : undefined}
          data-no-translate="true"
          translate="no"
          sx={{ color: error ? "error.main" : "text.secondary" }}
        >
          {message}
        </Text>
      )}
    </div>
  );
}
