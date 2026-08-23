/**
 * Toaster + toast (organism). KEEP-LIB: sonner (the app's existing toast system).
 * Re-exported so toasts are part of the DS surface (`import { toast, Toaster }
 * from "@/design-system"`). This intentionally standardizes on ONE toast system
 * (sonner); the legacy Radix `use-toast`/`toaster.tsx` stack is retired during
 * migration. The themed `Toaster` renderer stays in @/components/ui/sonner until
 * teardown moves it into the DS.
 * See docs/design/design-system/components/organisms/Toaster.md
 */
export { toast } from "sonner";
export { Toaster } from "@/components/ui/sonner";
