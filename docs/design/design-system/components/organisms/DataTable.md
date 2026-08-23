# DataTable — AG Grid (organism)

`DataTable` is the Tech Fleet data grid. It is **AG Grid Community** (MIT) — owner-locked
as the design system's table solution for any data-rich, sortable, filterable, paginated, or
editable table. AG Grid is re-exported into the DS surface **unchanged** (same API, same
theming), so you import it from `@/design-system` like every other component.

- **Layer:** organism · **Import:** `import { DataTable } from "@/design-system"`
- **Under the hood:** `ThemedAgGrid` — lazy-loaded AG Grid Community + its React bindings,
  themed through the `ag-theme-alpine` token mapping in `src/index.css`.

## Why AG Grid (not MUI Table)?

MUI's [`Table`](./Table) is included in the catalog for **simple, static** tables, but the
Tech Fleet default for real data is AG Grid: virtualized rows and columns (tens of thousands
of rows stay smooth), built-in sorting, filtering, column resize / reorder / pin, CSV export,
and cell selection — none of which we want to rebuild. This was an explicit product decision;
reach for `DataTable`, not MUI `Table`, whenever a table is interactive or data-heavy.

## Live demo

<Demo name="DataTable" />

## Usage

```tsx
import { DataTable } from "@/design-system";

const columnDefs = [
  { field: "name", headerName: "Name", flex: 1 },
  { field: "role", flex: 1 },
  { field: "projects", type: "numericColumn", width: 130 },
];

<DataTable rowData={rows} columnDefs={columnDefs} height="400px" gridId="team" />;
```

## Notes

- **Lazy-loaded** (~230 kB gz): the grid stays out of the initial bundle and loads on first
  mount, showing a skeleton fallback — so pages that never open a table pay nothing.
- The full AG Grid Community API (`AgGridReactProps`) is available, plus DS conveniences:
  `height`, `gridId`, `showExportCsv`, `toolbarLeft`, `onApiReady`, `hideColumnsPicker`.
- Charts use [recharts](./Chart); tables use AG Grid. Both are owner-locked keep-libraries
  that live inside the design system rather than being replaced by MUI.

## Reference

Source: [`src/design-system/components/organisms/DataTable.tsx`](https://github.com/techfleetworks/techfleetnetwork/blob/main/src/design-system/components/organisms/DataTable.tsx)
(re-exports `src/components/AgGrid.tsx`, the lazy `ThemedAgGrid` wrapper — intentionally
unchanged by the migration).
