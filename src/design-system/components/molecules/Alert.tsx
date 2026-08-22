/**
 * Alert (molecule). Replaces src/components/ui/alert.tsx.
 * MUI Alert; `variant` maps to a severity. See components/molecules/Alert.md
 */
import type { ReactNode } from "react";
import MuiAlert, { type AlertProps as MuiAlertProps } from "@mui/material/Alert";
import MuiAlertTitle from "@mui/material/AlertTitle";

export type AlertVariant = "default" | "destructive" | "success" | "warning" | "info";

const SEVERITY: Record<AlertVariant, MuiAlertProps["severity"]> = {
  default: "info",
  destructive: "error",
  success: "success",
  warning: "warning",
  info: "info",
};

export interface AlertProps extends Omit<MuiAlertProps, "variant" | "severity"> {
  variant?: AlertVariant;
}

export function Alert({ variant = "default", ...props }: AlertProps) {
  return <MuiAlert severity={SEVERITY[variant]} {...props} />;
}

export const AlertTitle = MuiAlertTitle;

export function AlertDescription({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}
