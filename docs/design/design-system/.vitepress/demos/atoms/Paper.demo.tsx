import { Paper } from "@/design-system";

export default function PaperDemo() {
  return (
    <>
      {[0, 1, 3, 6].map((e) => (
        <Paper key={e} elevation={e} style={{ padding: 20, minWidth: 96, textAlign: "center" }}>
          elevation={e}
        </Paper>
      ))}
    </>
  );
}
