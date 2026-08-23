import { useMediaQuery } from "@/design-system";

export default function UseMediaQueryDemo() {
  const wide = useMediaQuery("(min-width: 768px)");
  const dark = useMediaQuery("(prefers-color-scheme: dark)");
  return (
    <div style={{ fontSize: 14, lineHeight: 1.9 }}>
      <div>
        Viewport ≥ 768px: <strong>{String(wide)}</strong>
      </div>
      <div>
        OS prefers dark: <strong>{String(dark)}</strong>
      </div>
      <div style={{ color: "var(--vp-c-text-2)" }}>Resize the window — these update live.</div>
    </div>
  );
}
