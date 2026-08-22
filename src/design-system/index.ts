/**
 * TechFleet Design System (TFDS) — public barrel.
 * The app imports UI ONLY from `@/design-system` (enforced by ESLint).
 * Built on MUI Core (MIT). See docs/design/design-system/.
 */

// Provider
export { DesignSystemProvider } from "./provider/DesignSystemProvider";

// Theme (for tooling / tests)
export { createAppTheme } from "./theme/createAppTheme";
export type { Mode } from "./theme/tokens";

// Atoms
export { Button } from "./components/atoms/Button";
export type { ButtonProps, TfButtonVariant, TfButtonSize } from "./components/atoms/Button";
export { Text } from "./components/atoms/Text";
export type { TextProps, TextBrand } from "./components/atoms/Text";
export { Icon } from "./components/atoms/Icon";
export type { IconProps } from "./components/atoms/Icon";

// Molecules
export {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
  CardTitle,
  CardDescription,
} from "./components/molecules/Card";
export type { CardProps, CardVariant } from "./components/molecules/Card";
