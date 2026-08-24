import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import {
  DesignSystemProvider,
  Avatar,
  AvatarFallback,
  Progress,
  Slider,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
  RadioGroup,
  RadioGroupItem,
  AspectRatio,
  ScrollArea,
} from "@/design-system";

function renderDS(ui: ReactNode) {
  return render(
    <ThemeProvider defaultTheme="light">
      <DesignSystemProvider>{ui}</DesignSystemProvider>
    </ThemeProvider>
  );
}

describe("Phase 3A atoms", () => {
  it("Avatar renders its fallback text", () => {
    renderDS(
      <Avatar>
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>
    );
    expect(screen.getByText("AB")).toBeInTheDocument();
  });

  it("Progress renders a determinate progressbar with value", () => {
    renderDS(<Progress value={40} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "40");
  });

  it("Slider renders a slider control", () => {
    renderDS(<Slider defaultValue={30} aria-label="vol" />);
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("Toggle renders a pressable button", () => {
    renderDS(<Toggle value="bold">B</Toggle>);
    expect(screen.getByRole("button", { name: "B" })).toBeInTheDocument();
  });

  it("ToggleGroup renders its items", () => {
    renderDS(
      <ToggleGroup>
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>
    );
    expect(screen.getByRole("button", { name: "A" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "B" })).toBeInTheDocument();
  });

  it("RadioGroup renders radios", () => {
    renderDS(
      <RadioGroup defaultValue="x">
        <RadioGroupItem value="x" />
        <RadioGroupItem value="y" />
      </RadioGroup>
    );
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("AspectRatio and ScrollArea render their children", () => {
    renderDS(
      <AspectRatio>
        <ScrollArea>content</ScrollArea>
      </AspectRatio>
    );
    expect(screen.getByText("content")).toBeInTheDocument();
  });
});
