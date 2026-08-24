import { Container, Paper } from "@/design-system";

export default function ContainerDemo() {
  return (
    <div style={{ width: "100%" }}>
      <Container maxWidth="sm" disableGutters>
        <Paper elevation={2} style={{ padding: 20, textAlign: "center" }}>
          maxWidth=&quot;sm&quot; — a centered, width-capped content column.
        </Paper>
      </Container>
    </div>
  );
}
