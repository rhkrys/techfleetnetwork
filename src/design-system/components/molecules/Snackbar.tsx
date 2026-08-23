/**
 * Snackbar (molecule) — MUI's transient bottom notification primitive.
 *
 * NOTE: the app's standardized toast system is `Toaster`/`toast` (sonner). Use
 * that for app notifications. Raw Snackbar/SnackbarContent are exported for full
 * MUI parity and cases needing MUI's positioning/transition API directly.
 * See docs/design/design-system/components/molecules/Snackbar.md
 */
export { default as Snackbar } from "@mui/material/Snackbar";
export type { SnackbarProps } from "@mui/material/Snackbar";
export { default as SnackbarContent } from "@mui/material/SnackbarContent";
export type { SnackbarContentProps } from "@mui/material/SnackbarContent";
