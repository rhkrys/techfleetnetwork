/**
 * FormControl family (molecule) — the raw MUI form-grouping primitives that
 * coordinate label/input/helper state (focused, error, required).
 *
 * NOTE: for app forms prefer the `Field` molecule + the RHF* adapters, which
 * wire accessibility (aria-describedby, role=alert) for you. These raw parts
 * exist for full MUI parity and custom control compositions.
 * See docs/design/design-system/components/molecules/FormControl.md
 */
export { default as FormControl } from "@mui/material/FormControl";
export type { FormControlProps } from "@mui/material/FormControl";
export { default as FormControlLabel } from "@mui/material/FormControlLabel";
export type { FormControlLabelProps } from "@mui/material/FormControlLabel";
export { default as FormGroup } from "@mui/material/FormGroup";
export type { FormGroupProps } from "@mui/material/FormGroup";
export { default as FormHelperText } from "@mui/material/FormHelperText";
export type { FormHelperTextProps } from "@mui/material/FormHelperText";
export { default as FormLabel } from "@mui/material/FormLabel";
export type { FormLabelProps } from "@mui/material/FormLabel";
export { default as InputLabel } from "@mui/material/InputLabel";
export type { InputLabelProps } from "@mui/material/InputLabel";
