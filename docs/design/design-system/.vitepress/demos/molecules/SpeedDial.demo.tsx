import { SpeedDial, SpeedDialAction, SpeedDialIcon } from "@/design-system";
import Save from "@mui/icons-material/Save";
import Print from "@mui/icons-material/Print";
import Share from "@mui/icons-material/Share";

export default function SpeedDialDemo() {
  return (
    <div style={{ height: 220, position: "relative", width: "100%" }}>
      <SpeedDial
        ariaLabel="Quick actions"
        sx={{ position: "absolute", bottom: 16, right: 16 }}
        icon={<SpeedDialIcon />}
      >
        <SpeedDialAction icon={<Save />} slotProps={{ tooltip: { title: "Save" } }} />
        <SpeedDialAction icon={<Print />} slotProps={{ tooltip: { title: "Print" } }} />
        <SpeedDialAction icon={<Share />} slotProps={{ tooltip: { title: "Share" } }} />
      </SpeedDial>
    </div>
  );
}
