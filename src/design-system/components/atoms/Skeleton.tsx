/**
 * Skeleton (atom) — loading placeholder. Replaces src/components/ui/skeleton.tsx.
 * MUI Skeleton (rounded, pulse). See components/atoms/Skeleton.md
 */
import MuiSkeleton, { type SkeletonProps } from "@mui/material/Skeleton";

export function Skeleton({ variant = "rounded", ...props }: SkeletonProps) {
  return <MuiSkeleton variant={variant} {...props} />;
}

export type { SkeletonProps };
