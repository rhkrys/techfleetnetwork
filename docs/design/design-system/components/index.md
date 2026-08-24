# Components

Every component is imported from the single owned surface:

```ts
import { Button, Text, Card, Field, Select, Dialog /* … */ } from "@/design-system";
```

The library is organized by [Atomic Design](/README#shared-vocabulary-atomic-design) layer. Each page below
documents a component's API, how it differs from stock MUI / the shadcn component it replaces, its accessibility
behavior, and usage.

## Atoms

Button · Text (typography) · Icon · Badge · Label · Input · Textarea · Checkbox · Switch · Skeleton · Separator ·
Avatar · Progress · Slider · Toggle · ToggleGroup · RadioGroup · AspectRatio · ScrollArea · InputOTP

## Molecules

Card · Field + RHF adapters · Alert · Tooltip · Breadcrumb · Accordion · Collapsible · Pagination · Select ·
Tabs · Popover · DropdownMenu · Autocomplete / MultiSelect · ConfirmDialog · CharCountTextarea · ResponsiveTabs ·
HoverCard · ValidatedField · SaveStatus

## Organisms

Dialog · AlertDialog · Sheet · Drawer · Toaster · **DataTable (AG Grid)** · Command · Calendar · **Chart (recharts)**

---

> **Note.** Written per-component pages are being filled in from each component's in-code documentation.
> Atoms and the Phase 0–2 molecules/organisms have full pages (see the sidebar); the remaining components are
> documented in their source file headers and are being expanded here. The
> [component audit](/component-audit) lists every component with its status.
