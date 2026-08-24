import { useState } from "react";
import { Fade, Grow, Zoom, Collapse, Button, Paper } from "@/design-system";

function box(label: string) {
  return (
    <Paper elevation={2} style={{ padding: 16, width: 80, textAlign: "center" }}>
      {label}
    </Paper>
  );
}

export default function TransitionsDemo() {
  const [on, setOn] = useState(true);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Button variant="outline" onClick={() => setOn((o) => !o)}>
        Toggle
      </Button>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", minHeight: 64 }}>
        <Fade in={on}>{box("Fade")}</Fade>
        <Grow in={on}>{box("Grow")}</Grow>
        <Zoom in={on}>{box("Zoom")}</Zoom>
        <Collapse in={on} orientation="horizontal">
          {box("Collapse")}
        </Collapse>
      </div>
    </div>
  );
}
