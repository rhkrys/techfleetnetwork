import { ButtonGroup, Button } from "@/design-system";

export default function ButtonGroupDemo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ButtonGroup>
        <Button variant="outline">Day</Button>
        <Button variant="outline">Week</Button>
        <Button variant="outline">Month</Button>
      </ButtonGroup>
      <ButtonGroup orientation="vertical">
        <Button variant="outline">Top</Button>
        <Button variant="outline">Middle</Button>
        <Button variant="outline">Bottom</Button>
      </ButtonGroup>
    </div>
  );
}
