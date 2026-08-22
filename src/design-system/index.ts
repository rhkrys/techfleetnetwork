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
export { Field } from "./components/molecules/Field";
export type { FieldProps } from "./components/molecules/Field";
export { Alert, AlertTitle, AlertDescription } from "./components/molecules/Alert";
export type { AlertProps, AlertVariant } from "./components/molecules/Alert";
export { Tooltip } from "./components/molecules/Tooltip";
export type { TooltipProps } from "./components/molecules/Tooltip";

// Molecules — react-hook-form field adapters
export { RHFTextField } from "./components/molecules/form/RHFTextField";
export type { RHFTextFieldProps } from "./components/molecules/form/RHFTextField";
export { RHFTextarea } from "./components/molecules/form/RHFTextarea";
export type { RHFTextareaProps } from "./components/molecules/form/RHFTextarea";
export { RHFCheckbox } from "./components/molecules/form/RHFCheckbox";
export type { RHFCheckboxProps } from "./components/molecules/form/RHFCheckbox";
export { RHFSwitch } from "./components/molecules/form/RHFSwitch";
export type { RHFSwitchProps } from "./components/molecules/form/RHFSwitch";

// Organisms
export {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from "./components/organisms/Dialog";
export type { DialogProps } from "./components/organisms/Dialog";
