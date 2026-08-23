/**
 * AspectRatio (atom). Replaces src/components/ui/aspect-ratio.tsx.
 * A Box with a CSS aspect-ratio. shadcn used `ratio` (number, w/h).
 * See docs/design/design-system/components/atoms/AspectRatio.md
 */
import Box, { type BoxProps } from "@mui/material/Box";

export interface AspectRatioProps extends BoxProps {
  ratio?: number;
}

export function AspectRatio({ ratio = 16 / 9, sx, ...props }: AspectRatioProps) {
  return (
    <Box
      sx={[
        { position: "relative", width: "100%", aspectRatio: String(ratio) },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...props}
    />
  );
}
