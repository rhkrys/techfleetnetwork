/**
 * TechFleet Design System (TFDS) — public barrel.
 * The app imports UI ONLY from `@/design-system` (enforced by ESLint).
 * Built on MUI Core (MIT). See docs/design/design-system/.
 */

// Provider
export { DesignSystemProvider } from "./provider/DesignSystemProvider";

// Layout — 4px grid + 12-column responsive system
export { Grid } from "./components/layout/Grid";
export type { GridProps } from "./components/layout/Grid";
export { Container } from "./components/layout/Container";
export type { ContainerProps } from "./components/layout/Container";
export { Stack } from "./components/layout/Stack";
export type { StackProps } from "./components/layout/Stack";

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
export { Avatar, AvatarImage, AvatarFallback } from "./components/atoms/Avatar";
export type { AvatarProps } from "./components/atoms/Avatar";
export { Progress } from "./components/atoms/Progress";
export type { ProgressProps } from "./components/atoms/Progress";
export { Slider } from "./components/atoms/Slider";
export type { SliderProps } from "./components/atoms/Slider";
export { Toggle } from "./components/atoms/Toggle";
export type { ToggleProps } from "./components/atoms/Toggle";
export { ToggleGroup, ToggleGroupItem } from "./components/atoms/ToggleGroup";
export type { ToggleGroupProps } from "./components/atoms/ToggleGroup";
export { RadioGroup, RadioGroupItem } from "./components/atoms/RadioGroup";
export type { RadioGroupProps } from "./components/atoms/RadioGroup";
export { AspectRatio } from "./components/atoms/AspectRatio";
export type { AspectRatioProps } from "./components/atoms/AspectRatio";
export { ScrollArea, ScrollBar } from "./components/atoms/ScrollArea";

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
export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
} from "./components/molecules/Breadcrumb";
export type { BreadcrumbProps } from "./components/molecules/Breadcrumb";
export {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./components/molecules/Accordion";
export type { AccordionProps } from "./components/molecules/Accordion";
export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./components/molecules/Collapsible";
export { Pagination } from "./components/molecules/Pagination";
export type { PaginationProps } from "./components/molecules/Pagination";
export { Select, SelectItem } from "./components/molecules/Select";
export type { SelectProps } from "./components/molecules/Select";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/molecules/Tabs";
export type { TabsProps } from "./components/molecules/Tabs";
export { Popover, PopoverTrigger, PopoverContent } from "./components/molecules/Popover";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./components/molecules/DropdownMenu";
export { Autocomplete, MultiSelect } from "./components/molecules/Autocomplete";
export type { MultiSelectProps, MultiSelectOption } from "./components/molecules/Autocomplete";
export { ConfirmDialog } from "./components/molecules/ConfirmDialog";
export type { ConfirmDialogProps } from "./components/molecules/ConfirmDialog";
export { CharCountTextarea } from "./components/molecules/CharCountTextarea";
export type { CharCountTextareaProps } from "./components/molecules/CharCountTextarea";
export {
  ResponsiveTabs,
  ResponsiveTabsList,
  ResponsiveTabsTrigger,
  ResponsiveTabsContent,
} from "./components/molecules/ResponsiveTabs";
export { HoverCard, HoverCardTrigger, HoverCardContent } from "./components/molecules/HoverCard";
export { SaveStatus } from "./components/molecules/SaveStatus";
export type { SaveStatusProps, SaveState } from "./components/molecules/SaveStatus";
export { ValidatedField } from "./components/molecules/ValidatedField";
export type { ValidatedFieldProps } from "./components/molecules/ValidatedField";
// KEEP-LIB, re-exported (interim; rebuilt on raw libs at teardown)
export * from "./components/atoms/InputOTP";

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
export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "./components/organisms/AlertDialog";
export type { AlertDialogProps } from "./components/organisms/AlertDialog";
export {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from "./components/organisms/Sheet";
export type { SheetProps } from "./components/organisms/Sheet";
export { Drawer } from "./components/organisms/Drawer";
export type { DrawerProps } from "./components/organisms/Drawer";
// AG Grid, re-exported unchanged (see DataTable.tsx). The DS table solution.
export { DataTable, ThemedAgGrid } from "./components/organisms/DataTable";
// KEEP-LIB organisms, re-exported (interim; rebuilt on raw libs at teardown)
export * from "./components/organisms/Command";
export * from "./components/organisms/Calendar";
export * from "./components/organisms/Chart";
export { Toaster, toast } from "./components/organisms/Toaster";
