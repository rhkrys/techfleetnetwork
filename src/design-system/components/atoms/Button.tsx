/**
 * Button (atom) — Tech Fleet button on MUI Button.
 * Replaces src/components/ui/button.tsx. 9 variants + 5 sizes, asymmetric
 * radius + --tf-btn shadows come from the theme (theme/components.ts).
 * See docs/design/design-system/components/atoms/Button.md
 */
import {
  forwardRef,
  isValidElement,
  type ElementType,
  type ReactElement,
  type ReactNode,
} from "react";
import MuiButton, { type ButtonProps as MuiButtonProps } from "@mui/material/Button";

export type TfButtonVariant = NonNullable<MuiButtonProps["variant"]>;
export type TfButtonSize = "default" | "sm" | "lg" | "xl" | "icon";

export interface ButtonProps extends Omit<MuiButtonProps, "size"> {
  size?: TfButtonSize;
  /**
   * Render as another element/component (polymorphic), e.g. a router Link:
   * `<Button component={Link} to="/x">`. `to`/`href` pass through to it.
   */
  component?: ElementType;
  to?: string;
  /**
   * Radix-style slot compat: render AS the single child element (e.g. a router
   * `<Link>` or an `<a>`), applying the button's styling to it. Shim for the
   * shadcn `<Button asChild><Link/></Button>` pattern — mapped onto MUI's
   * `component`, so `<Button asChild><Link to="/x">…</Link></Button>` renders a
   * single styled anchor (never a `<button>` wrapping an `<a>`).
   */
  asChild?: boolean;
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
  { size = "default", sx, variant = "default", asChild, children, ...props },
  ref
) {
  const sizeSx = [SIZE_SX[size], ...(Array.isArray(sx) ? sx : [sx])];

  // asChild: adopt the single child's element type + props (to/href/…) and style
  // it as the button via MUI's `component`. The button's own props win on
  // conflict; className is merged so the child keeps any classes it had.
  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<
      { children?: ReactNode; className?: string } & Record<string, unknown>
    >;
    const { children: slotChildren, className: slotClassName, ...slotProps } = child.props;
    const mergedClassName =
      [slotClassName, (props as { className?: string }).className].filter(Boolean).join(" ") ||
      undefined;
    return (
      <MuiButton
        ref={ref}
        variant={variant}
        sx={sizeSx}
        {...(slotProps as MuiButtonProps)}
        {...(props as MuiButtonProps)}
        component={child.type as ElementType}
        className={mergedClassName}
      >
        {slotChildren}
      </MuiButton>
    );
  }

  return (
    <MuiButton
      ref={ref}
      variant={variant}
      sx={sizeSx}
      // MUI Button is polymorphic (OverridableComponent); the wrapper is not, so
      // cast the passthrough (incl. component/to) — MUI forwards them to the root.
      {...(props as MuiButtonProps)}
    >
      {children}
    </MuiButton>
  );
});
