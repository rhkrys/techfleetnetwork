import { Popover, PopoverTrigger, PopoverContent, Button } from "@/design-system";

export default function PopoverDemo() {
  return (
    <Popover>
      <PopoverTrigger>
        <Button variant="outline">Open popover</Button>
      </PopoverTrigger>
      <PopoverContent>
        <div style={{ padding: 12, maxWidth: 240 }}>
          Popover content — anchored to the trigger, dismissed on outside click.
        </div>
      </PopoverContent>
    </Popover>
  );
}
