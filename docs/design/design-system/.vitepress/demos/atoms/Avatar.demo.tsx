import { Avatar } from "@/design-system";

export default function AvatarDemo() {
  return (
    <>
      <Avatar>TF</Avatar>
      <Avatar sx={{ bgcolor: "primary.main" }}>AB</Avatar>
      <Avatar sx={{ bgcolor: "success.main" }}>CD</Avatar>
      <Avatar
        src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><rect width='40' height='40' fill='%230056a7'/></svg>"
        alt="swatch"
      />
    </>
  );
}
