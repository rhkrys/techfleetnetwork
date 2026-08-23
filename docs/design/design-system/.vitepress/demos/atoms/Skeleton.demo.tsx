import { Skeleton } from "@/design-system";

export default function SkeletonDemo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, width: "100%", maxWidth: 320 }}>
      <Skeleton variant="circular" width={48} height={48} />
      <div style={{ flex: 1 }}>
        <Skeleton variant="text" />
        <Skeleton variant="text" width="60%" />
        <Skeleton variant="rectangular" height={40} style={{ marginTop: 8, borderRadius: 6 }} />
      </div>
    </div>
  );
}
