/**
 * Breadcrumb (molecule). Replaces src/components/ui/breadcrumb.tsx.
 * MUI Breadcrumbs. Compat sub-parts map the shadcn compound API onto MUI, which
 * inserts separators automatically. See components/molecules/Breadcrumb.md
 */
import type { ReactNode } from "react";
import MuiBreadcrumbs, { type BreadcrumbsProps } from "@mui/material/Breadcrumbs";
import MuiLink from "@mui/material/Link";
import { Text } from "../atoms/Text";

export function Breadcrumb(props: BreadcrumbsProps) {
  return <MuiBreadcrumbs {...props} />;
}
/** shadcn had a <BreadcrumbList>; MUI Breadcrumbs is the list itself. */
export const BreadcrumbList = ({ children }: { children: ReactNode }) => <>{children}</>;
export const BreadcrumbItem = ({ children }: { children: ReactNode }) => <>{children}</>;
export const BreadcrumbLink = ({ href, children }: { href?: string; children: ReactNode }) => (
  <MuiLink href={href} underline="hover" color="inherit">
    {children}
  </MuiLink>
);
export const BreadcrumbPage = ({ children }: { children: ReactNode }) => (
  <Text brand="bodySmall" as="span">
    {children}
  </Text>
);
/** MUI inserts separators automatically; this is a no-op for compat. */
export const BreadcrumbSeparator = () => null;
export const BreadcrumbEllipsis = () => <span aria-hidden>…</span>;

export type { BreadcrumbsProps as BreadcrumbProps };
