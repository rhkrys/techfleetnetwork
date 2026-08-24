import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import {
  DesignSystemProvider,
  MultiSelect,
  ConfirmDialog,
  CharCountTextarea,
  Drawer,
} from "@/design-system";

function renderDS(ui: ReactNode) {
  return render(
    <ThemeProvider defaultTheme="light">
      <DesignSystemProvider>{ui}</DesignSystemProvider>
    </ThemeProvider>
  );
}

const OPTS = [
  { value: "a", label: "Apple" },
  { value: "b", label: "Banana" },
];

describe("MultiSelect (molecule)", () => {
  it("renders selected options as chips", () => {
    renderDS(<MultiSelect options={OPTS} selected={["a"]} onChange={() => {}} label="Fruit" />);
    expect(screen.getByText("Apple")).toBeInTheDocument();
  });
});

describe("ConfirmDialog (molecule)", () => {
  it("shows title/consequence and confirms", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    renderDS(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete project?"
        consequence="This cannot be undone."
        actionLabel="Delete"
        onConfirm={onConfirm}
      />
    );
    expect(screen.getByText("Delete project?")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("CharCountTextarea (molecule)", () => {
  it("shows a live character count that updates as you type", async () => {
    renderDS(<CharCountTextarea maxLength={100} aria-label="Bio" />);
    expect(screen.getByText("0/100")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox"), "hello");
    expect(screen.getByText("5/100")).toBeInTheDocument();
  });
});

describe("Drawer (organism)", () => {
  it("renders its children when open", () => {
    renderDS(
      <Drawer open onClose={() => {}}>
        <div>Drawer body</div>
      </Drawer>
    );
    expect(screen.getByText("Drawer body")).toBeInTheDocument();
  });
});
