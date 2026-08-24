import { Link } from "@/design-system";

export default function LinkDemo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Link href="#link-demo">Default brand link</Link>
      <Link href="#link-demo" underline="always">
        Always underlined
      </Link>
      <Link href="#link-demo" color="inherit">
        Inherit color
      </Link>
    </div>
  );
}
