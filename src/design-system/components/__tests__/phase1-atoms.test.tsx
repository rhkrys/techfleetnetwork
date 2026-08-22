import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import {
  DesignSystemProvider,
  Badge,
  Label,
  Input,
  Textarea,
  Checkbox,
  Switch,
  Skeleton,
  Separator,
} from "@/design-system";

function renderDS(ui: ReactNode) {
  return render(
    <ThemeProvider defaultTheme="light">
      <DesignSystemProvider>{ui}</DesignSystemProvider>
    </ThemeProvider>
  );
}

describe("Badge (atom)", () => {
  it.each(["default", "secondary", "destructive", "outline"] as const)(
    "renders the %s variant with its label",
    (variant) => {
      renderDS(<Badge variant={variant}>{variant}</Badge>);
      expect(screen.getByText(variant)).toBeInTheDocument();
    }
  );
});

describe("Label (atom)", () => {
  it("renders and binds to a field via htmlFor", () => {
    renderDS(
      <>
        <Label htmlFor="f1">Name</Label>
        <Input id="f1" />
      </>
    );
    const label = screen.getByText("Name");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", "f1");
  });
});

describe("Input (atom)", () => {
  it("renders a textbox and reflects value", () => {
    renderDS(<Input defaultValue="hello" />);
    expect(screen.getByRole("textbox")).toHaveValue("hello");
  });

  it("sets aria-invalid when error", () => {
    renderDS(<Input error defaultValue="x" />);
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("Textarea (atom)", () => {
  it("renders a multiline textbox", () => {
    renderDS(<Textarea defaultValue="lines" />);
    const el = screen.getByRole("textbox");
    expect(el.tagName).toBe("TEXTAREA");
    expect(el).toHaveValue("lines");
  });
});

describe("Checkbox (atom)", () => {
  it("renders checked when defaultChecked", () => {
    renderDS(<Checkbox defaultChecked />);
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
});

describe("Switch (atom)", () => {
  it("renders a toggle input, unchecked by default", () => {
    const { container } = renderDS(<Switch />);
    const input = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(input).toBeTruthy();
    expect(input).not.toBeChecked();
  });
});

describe("Skeleton (atom)", () => {
  it("renders", () => {
    renderDS(<Skeleton data-testid="sk" height={20} />);
    expect(screen.getByTestId("sk")).toBeInTheDocument();
  });
});

describe("Separator (atom)", () => {
  it("renders a separator element", () => {
    renderDS(<Separator />);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });
});
