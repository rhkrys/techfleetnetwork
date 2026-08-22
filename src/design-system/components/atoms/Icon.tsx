/**
 * Icon (atom) — a11y wrapper over @mui/icons-material (Material icons,
 * owner-confirmed). Replaces the lucide-react-backed src/components/ui/icon.tsx.
 * Restraint rule: icons are functional affordances, not heading decoration.
 * See docs/design/design-system/components/atoms/Icon.md
 */
import type { SvgIconComponent } from "@mui/icons-material";
import type { SxProps, Theme } from "@mui/material/styles";

export interface IconProps {
  /** A Material icon component, e.g. `import Add from "@mui/icons-material/Add"`. */
  icon: SvgIconComponent;
  /** `ui` = 24px, `micro` = 16px, or an explicit pixel size. */
  size?: "ui" | "micro" | number;
  /**
   * Accessible label. Omit for purely decorative icons (rendered aria-hidden);
   * provide for meaningful icons (rendered role="img" with this label).
   */
  label?: string;
  className?: string;
  sx?: SxProps<Theme>;
}

const SIZE_PX = { ui: 24, micro: 16 } as const;

export function Icon({ icon: IconComponent, size = "ui", label, className, sx }: IconProps) {
  const px = typeof size === "number" ? size : SIZE_PX[size];
  const a11y = label
    ? { role: "img" as const, "aria-label": label }
    : { "aria-hidden": true as const, focusable: false };
  return <IconComponent className={className} sx={{ fontSize: px, ...sx }} {...a11y} />;
}
