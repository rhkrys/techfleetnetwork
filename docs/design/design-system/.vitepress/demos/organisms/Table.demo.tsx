import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from "@/design-system";

const rows = [
  { name: "Ada", role: "Engineer", projects: 6 },
  { name: "Grace", role: "PM", projects: 4 },
  { name: "Alan", role: "Designer", projects: 9 },
];

export default function TableDemo() {
  return (
    <TableContainer component={Paper} style={{ maxWidth: 460 }}>
      <Table size="small" aria-label="team">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Role</TableCell>
            <TableCell align="right">Projects</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.name}>
              <TableCell>{r.name}</TableCell>
              <TableCell>{r.role}</TableCell>
              <TableCell align="right">{r.projects}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
