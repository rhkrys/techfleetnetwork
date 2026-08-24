import { Grid, Paper } from "@/design-system";

export default function GridDemo() {
  return (
    <Grid container spacing={2} sx={{ width: "100%" }}>
      {[
        { xs: 12, md: 6 },
        { xs: 6, md: 3 },
        { xs: 6, md: 3 },
        { xs: 12, md: 4 },
        { xs: 12, md: 8 },
      ].map((size, i) => (
        <Grid key={i} size={size}>
          <Paper elevation={2} style={{ padding: 16, textAlign: "center" }}>
            {JSON.stringify(size)}
          </Paper>
        </Grid>
      ))}
    </Grid>
  );
}
