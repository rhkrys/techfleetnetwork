import { Box } from "@/design-system";

export default function BoxDemo() {
  return (
    <Box
      sx={{
        display: "flex",
        gap: 2,
        p: 3,
        borderRadius: 2,
        bgcolor: "primary.main",
        color: "primary.contrastText",
      }}
    >
      <Box sx={{ p: 2, bgcolor: "rgba(255,255,255,0.15)", borderRadius: 1 }}>sx</Box>
      <Box sx={{ p: 2, bgcolor: "rgba(255,255,255,0.15)", borderRadius: 1 }}>styling</Box>
      <Box sx={{ p: 2, bgcolor: "rgba(255,255,255,0.15)", borderRadius: 1 }}>prop</Box>
    </Box>
  );
}
