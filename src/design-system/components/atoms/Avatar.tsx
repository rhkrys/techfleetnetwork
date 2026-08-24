/**
 * Avatar (atom). Replaces src/components/ui/avatar.tsx.
 * MUI Avatar. NOTE: shadcn used a compound API (Avatar/AvatarImage/AvatarFallback);
 * MUI Avatar takes `src`/`alt` and falls back to `children`. AvatarImage/AvatarFallback
 * are provided as thin compat shims for mechanical migration.
 * See docs/design/design-system/components/atoms/Avatar.md
 */
import { forwardRef, type ReactNode } from "react";
import MuiAvatar, { type AvatarProps } from "@mui/material/Avatar";

export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(function Avatar(props, ref) {
  return <MuiAvatar ref={ref} {...props} />;
});

/** Compat: `<AvatarImage src alt />` → sets the Avatar's image. */
export function AvatarImage({ src, alt }: { src?: string; alt?: string }) {
  return (
    <img src={src} alt={alt ?? ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
  );
}

/** Compat: `<AvatarFallback>AB</AvatarFallback>` → shown when no image. */
export function AvatarFallback({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export type { AvatarProps };
