import { Stack, Paper } from "@/design-system";

export default function StackDemo() {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ width: "100%" }}>
      <Paper elevation={2} style={{ padding: 16, flex: 1, textAlign: "center" }}>
        One
      </Paper>
      <Paper elevation={2} style={{ padding: 16, flex: 1, textAlign: "center" }}>
        Two
      </Paper>
      <Paper elevation={2} style={{ padding: 16, flex: 1, textAlign: "center" }}>
        Three
      </Paper>
    </Stack>
  );
}
