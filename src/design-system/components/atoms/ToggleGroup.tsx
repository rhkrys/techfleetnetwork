/**
 * ToggleGroup (atom). Replaces src/components/ui/toggle-group.tsx.
 * MUI ToggleButtonGroup + ToggleButton (exported as ToggleGroupItem).
 * See docs/design/design-system/components/atoms/ToggleGroup.md
 */
import ToggleButtonGroup, { type ToggleButtonGroupProps } from "@mui/material/ToggleButtonGroup";
import ToggleButton from "@mui/material/ToggleButton";

export function ToggleGroup(props: ToggleButtonGroupProps) {
  return <ToggleButtonGroup {...props} />;
}

export const ToggleGroupItem = ToggleButton;
export type { ToggleButtonGroupProps as ToggleGroupProps };
