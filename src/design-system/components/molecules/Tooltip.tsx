/**
 * Tooltip (molecule). Replaces src/components/ui/tooltip.tsx.
 *
 * NOTE: API differs from the shadcn compound form. MUI Tooltip is a single
 * wrapper — `<Tooltip title="…"><Trigger/></Tooltip>` — not
 * Tooltip/TooltipTrigger/TooltipContent. No TooltipProvider is needed.
 * See components/molecules/Tooltip.md
 */
import MuiTooltip, { type TooltipProps } from "@mui/material/Tooltip";

export function Tooltip({ arrow = true, ...props }: TooltipProps) {
  return <MuiTooltip arrow={arrow} {...props} />;
}

export type { TooltipProps };
