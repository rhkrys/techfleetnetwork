import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { DesignSystemProvider } from "@/design-system";
import { Button } from "../atoms/Button";
import { Text } from "../atoms/Text";
import { Card, CardHeader, CardTitle, CardContent } from "../molecules/Card";

/** Render inside the app ThemeProvider (light/dark source) + the MUI theme. */
function renderDS(ui: ReactNode) {
  return render(
    <ThemeProvider defaultTheme="light">
      <DesignSystemProvider>{ui}</DesignSystemProvider>
    </ThemeProvider>
  );
}

describe("Button (atom)", () => {
  it("renders its label as a button", () => {
    renderDS(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it.each([
    "default",
    "hero",
    "success",
    "destructive",
    "outline",
    "secondary",
    "hero-outline",
    "ghost",
    "link",
  ] as const)("renders the %s variant", (variant) => {
    renderDS(<Button variant={variant}>{variant}</Button>);
    expect(screen.getByRole("button", { name: variant })).toBeInTheDocument();
  });

  it("is disabled and does not fire onClick when disabled", () => {
    const onClick = vi.fn();
    renderDS(
      <Button disabled onClick={onClick}>
        Disabled
      </Button>
    );
    const btn = screen.getByRole("button", { name: "Disabled" });
    expect(btn).toBeDisabled();
    // fireEvent bypasses the pointer-events:none guard MUI sets on disabled
    // buttons; a disabled <button> still must not invoke its handler.
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("fires onClick when enabled", async () => {
    const onClick = vi.fn();
    renderDS(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Text (atom)", () => {
  it("renders pageTitle as an <h1> by default", () => {
    renderDS(<Text brand="pageTitle">Title</Text>);
    const el = screen.getByText("Title");
    expect(el.tagName).toBe("H1");
  });

  it("renders sectionTitle as an <h2>", () => {
    renderDS(<Text brand="sectionTitle">Section</Text>);
    expect(screen.getByText("Section").tagName).toBe("H2");
  });

  it("honors the `as` override for the semantic tag", () => {
    renderDS(
      <Text brand="pageTitle" as="h2">
        Override
      </Text>
    );
    expect(screen.getByText("Override").tagName).toBe("H2");
  });

  it("defaults to body as a <p>", () => {
    renderDS(<Text>Body copy</Text>);
    expect(screen.getByText("Body copy").tagName).toBe("P");
  });
});

describe("Card (molecule)", () => {
  it("renders its sub-parts and content", () => {
    renderDS(
      <Card>
        <CardHeader>
          <CardTitle>Heading</CardTitle>
        </CardHeader>
        <CardContent>Inside</CardContent>
      </Card>
    );
    expect(screen.getByText("Heading")).toBeInTheDocument();
    expect(screen.getByText("Inside")).toBeInTheDocument();
  });
});
