/**
 * Pagination (molecule). Replaces src/components/ui/pagination.tsx.
 * MUI Pagination. NOTE: shadcn was a compound API (PaginationContent/Item/Link/
 * Previous/Next/Ellipsis); MUI is a single control: `<Pagination count page onChange>`.
 * See components/molecules/Pagination.md
 */
import MuiPagination, { type PaginationProps } from "@mui/material/Pagination";

export function Pagination(props: PaginationProps) {
  return <MuiPagination color="primary" {...props} />;
}

export type { PaginationProps };
