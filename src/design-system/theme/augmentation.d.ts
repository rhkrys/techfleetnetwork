/**
 * Module augmentation — register TFDS custom MUI Button variants so
 * `<Button variant="hero">` type-checks. These map to the Tech Fleet button
 * skin defined in theme/components.ts. See component-audit.md (button = 9 variants).
 */
import "@mui/material/Button";

declare module "@mui/material/Button" {
  interface ButtonPropsVariantOverrides {
    // Tech Fleet variants (replace shadcn's cva variants of the same name)
    default: true;
    destructive: true;
    outline: true;
    secondary: true;
    ghost: true;
    link: true;
    hero: true;
    "hero-outline": true;
    success: true;
  }
}
