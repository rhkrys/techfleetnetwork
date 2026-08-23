// NOTE: the DS `DataTable` (ThemedAgGrid) is deeply app-integrated — it persists
// per-user grid state (useGridState -> useAuth) and reports through the app error
// boundary — so it can't mount outside the app shell. This demo renders the SAME
// underlying library (AG Grid Community v32) directly, so the docs show a real,
// working grid. In the app you use `import { DataTable } from "@/design-system"`,
// which adds Tech Fleet theming, a toolbar, CSV export, and column persistence.
// AG Grid v32's `ag-grid-community` PACKAGE auto-registers its modules (the app's
// AgGridImpl registers nothing), so we must NOT call ModuleRegistry here — doing so
// triggers "you are mixing modules and packages". Just import the grid + CSS.
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";

const columnDefs = [
  { field: "name", headerName: "Name", flex: 1 },
  { field: "role", headerName: "Role", flex: 1 },
  { field: "projects", headerName: "Projects", type: "numericColumn", width: 130 },
];

const rowData = [
  { name: "Ada Lovelace", role: "Engineer", projects: 6 },
  { name: "Grace Hopper", role: "Product Manager", projects: 4 },
  { name: "Alan Turing", role: "Designer", projects: 9 },
  { name: "Katherine Johnson", role: "Data Scientist", projects: 7 },
];

export default function DataTableDemo() {
  return (
    <div className="ag-theme-alpine" style={{ height: 260, width: "100%" }}>
      <AgGridReact rowData={rowData} columnDefs={columnDefs} />
    </div>
  );
}
