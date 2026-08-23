/**
 * Slider (atom). Replaces src/components/ui/slider.tsx.
 * MUI Slider. NOTE: shadcn (Radix) used `value: number[]` + `onValueChange`;
 * MUI uses `value: number | number[]` + `onChange(event, value)`.
 * See docs/design/design-system/components/atoms/Slider.md
 */
import MuiSlider, { type SliderProps } from "@mui/material/Slider";

export function Slider(props: SliderProps) {
  return <MuiSlider {...props} />;
}

export type { SliderProps };
