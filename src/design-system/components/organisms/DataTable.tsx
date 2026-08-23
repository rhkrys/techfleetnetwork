/**
 * DataTable (organism) — the Tech Fleet data grid.
 *
 * This is AG Grid (community), owner-confirmed as the DS table solution. Its
 * implementation is INTENTIONALLY UNCHANGED — this module only re-exports the
 * existing lazy-loaded `ThemedAgGrid` from `@/components/AgGrid` so the grid is
 * part of the design-system surface (import it from `@/design-system`) without
 * altering how AG Grid is coded or themed (the ag-theme-alpine token mapping in
 * src/index.css continues to drive its look).
 *
 * See docs/design/design-system/components/organisms/DataTable.md
 */
export { ThemedAgGrid, ThemedAgGrid as DataTable } from "@/components/AgGrid";
