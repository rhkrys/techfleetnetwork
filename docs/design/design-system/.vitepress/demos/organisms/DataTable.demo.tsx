import { DataTable } from "@/design-system";

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
    <div style={{ width: "100%" }}>
      <DataTable
        rowData={rowData}
        columnDefs={columnDefs}
        height="260px"
        gridId="docs-datatable-demo"
      />
    </div>
  );
}
