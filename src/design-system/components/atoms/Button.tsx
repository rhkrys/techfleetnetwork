/**
 * Button (atom) — Tech Fleet button on MUI Button.
 * Replaces src/components/ui/button.tsx. 9 variants + 5 sizes, asymmetric
 * radius + --tf-btn shadows come from the theme (theme/components.ts).
 * See docs/design/design-system/components/atoms/Button.md
 */
import { forwardRef } from "react";
import MuiButton, { type ButtonProps as MuiButtonProps } from "@mui/material/Button";

export type TfButtonVariant = NonNullable<MuiButtonProps["variant"]>;
export type TfButtonSize = "default" | "sm" | "lg" | "xl" | "icon";

export interface ButtonProps extends Omit<MuiButtonProps, "size"> {
  size?: TfButtonSize;
}

// Sizes all share the 40px height; they differ by horizontal padding (and the
// square `icon` size). Kept in the wrapper rather than the theme because MUI's
// native size prop ('small'|'medium'|'large') doesn't match our scale.
const SIZE_SX: Record<TfButtonSize, object> = {
  default: {},
  sm: { padding: "0 20px", fontSize: "0.875rem" },
  lg: { padding: "0 36px" },
  xl: { padding: "0 40px" },
  icon: { padding: 0, minWidth: 40, width: 40, borderRadius: "6px" },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { size = "default", sx, variant = "default", ...props },
  ref
) {
  return (
    <MuiButton
      ref={ref}
      variant={variant}
      sx={[SIZE_SX[size], ...(Array.isArray(sx) ? sx : [sx])]}
      {...props}
    />
  );
});
