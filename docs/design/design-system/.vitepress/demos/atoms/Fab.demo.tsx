import { Fab } from "@/design-system";
import Add from "@mui/icons-material/Add";
import Edit from "@mui/icons-material/Edit";

export default function FabDemo() {
  return (
    <>
      <Fab color="primary" aria-label="add">
        <Add />
      </Fab>
      <Fab color="secondary" size="small" aria-label="edit">
        <Edit />
      </Fab>
      <Fab variant="extended" color="primary">
        <Add style={{ marginRight: 8 }} />
        New project
      </Fab>
    </>
  );
}
