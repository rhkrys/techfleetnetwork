import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { ThemeProvider } from "@/components/ThemeProvider";
import {
  DesignSystemProvider,
  Field,
  Alert,
  AlertTitle,
  AlertDescription,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  RHFTextField,
  RHFCheckbox,
  Button,
} from "@/design-system";

function renderDS(ui: ReactNode) {
  return render(
    <ThemeProvider defaultTheme="light">
      <DesignSystemProvider>{ui}</DesignSystemProvider>
    </ThemeProvider>
  );
}

describe("Field (molecule)", () => {
  it("renders a bound label and the error message when present", () => {
    renderDS(
      <Field label="Email" htmlFor="e" error="Required">
        <input id="e" aria-label="Email" />
      </Field>
    );
    const label = screen.getByText("Email");
    expect(label).toHaveAttribute("for", "e");
    expect(screen.getByText("Required")).toBeInTheDocument();
  });
});

describe("RHFTextField (molecule)", () => {
  function Harness() {
    const { control } = useForm<{ email: string }>({ defaultValues: { email: "" } });
    return <RHFTextField name="email" control={control} label="Email" />;
  }
  it("binds to react-hook-form and updates on typing", async () => {
    renderDS(<Harness />);
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "a@b.com");
    expect(input).toHaveValue("a@b.com");
    expect(screen.getByText("Email")).toBeInTheDocument();
  });
});

describe("RHFCheckbox (molecule)", () => {
  function Harness() {
    const { control } = useForm<{ agree: boolean }>({ defaultValues: { agree: false } });
    return <RHFCheckbox name="agree" control={control} label="I agree" />;
  }
  it("toggles the bound value", async () => {
    renderDS(<Harness />);
    const box = screen.getByRole("checkbox");
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(box).toBeChecked();
  });
});

describe("Alert (molecule)", () => {
  it("renders a role=alert with title and description", () => {
    renderDS(
      <Alert variant="destructive">
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>Something went wrong.</AlertDescription>
      </Alert>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Heads up")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
  });
});

describe("Tooltip (molecule)", () => {
  it("renders its trigger child and applies the title as the accessible label", () => {
    renderDS(
      <Tooltip title="Help text">
        <Button>Hover me</Button>
      </Tooltip>
    );
    // MUI Tooltip clones the child and sets aria-label from `title`.
    expect(screen.getByRole("button", { name: "Help text" })).toBeInTheDocument();
    expect(screen.getByText("Hover me")).toBeInTheDocument();
  });
});

describe("Dialog (organism)", () => {
  it("renders content when open", () => {
    renderDS(
      <Dialog open onClose={() => {}}>
        <DialogTitle>Confirm</DialogTitle>
        <DialogContent>Are you sure?</DialogContent>
      </Dialog>
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    renderDS(
      <Dialog open={false} onClose={() => {}}>
        <DialogTitle>Confirm</DialogTitle>
      </Dialog>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
