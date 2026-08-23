import { AspectRatio } from "@/design-system";

export default function AspectRatioDemo() {
  return (
    <div style={{ width: 260 }}>
      <AspectRatio
        ratio={16 / 9}
        sx={{
          bgcolor: "primary.main",
          color: "primary.contrastText",
          borderRadius: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
        }}
      >
        16 : 9
      </AspectRatio>
    </div>
  );
}
