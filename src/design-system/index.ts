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
export { Badge } from "./components/atoms/Badge";
export type { BadgeVariant } from "./components/atoms/Badge";
export { Label } from "./components/atoms/Label";
export { Input } from "./components/atoms/Input";
export type { InputProps } from "./components/atoms/Input";
export { Textarea } from "./components/atoms/Textarea";
export type { TextareaProps } from "./components/atoms/Textarea";
export { Checkbox } from "./components/atoms/Checkbox";
export type { CheckboxProps } from "./components/atoms/Checkbox";
export { Switch } from "./components/atoms/Switch";
export type { SwitchProps } from "./components/atoms/Switch";
export { Skeleton } from "./components/atoms/Skeleton";
export type { SkeletonProps } from "./components/atoms/Skeleton";
export { Separator } from "./components/atoms/Separator";
export type { SeparatorProps } from "./components/atoms/Separator";

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
