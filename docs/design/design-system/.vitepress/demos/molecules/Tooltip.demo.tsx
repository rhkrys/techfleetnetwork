import { Tooltip, Button } from "@/design-system";

export default function TooltipDemo() {
  return (
    <>
      <Tooltip title="Saved to your account">
        <Button variant="outline">Hover me</Button>
      </Tooltip>
      <Tooltip title="Opens in a new tab" placement="bottom">
        <Button variant="ghost">Bottom</Button>
      </Tooltip>
    </>
  );
}
