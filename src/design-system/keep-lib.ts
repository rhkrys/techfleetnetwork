/**
 * TFDS keep-libraries — the heavy, third-party-backed components the DS wraps but
 * did NOT rebuild on MUI: AG Grid (DataTable), recharts (Chart), cmdk (Command),
 * react-day-picker (Calendar), sonner (Toaster/toast), input-otp (InputOTP).
 *
 * These live behind `@/design-system/keep-lib` (NOT the main `@/design-system`
 * barrel) on purpose: `export *`-ing them from the barrel eagerly pulls recharts,
 * cmdk, react-day-picker, sonner, and the AG Grid → ScopedErrorBoundary →
 * error-reporter chain into EVERY `import { Button } from "@/design-system"`. That
 * bloats the app graph and breaks/slows tests of unrelated components. Keeping them
 * on a subpath means only code that actually needs a grid/chart/etc. pays for it.
 *
 *   import { DataTable } from "@/design-system/keep-lib";
 *   import { toast, Toaster } from "@/design-system/keep-lib";
 */
export * from "./components/atoms/InputOTP";
export { DataTable, ThemedAgGrid } from "./components/organisms/DataTable";
export * from "./components/organisms/Command";
export * from "./components/organisms/Calendar";
export * from "./components/organisms/Chart";
export { Toaster, toast } from "./components/organisms/Toaster";
