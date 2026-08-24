import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import {
  DesignSystemProvider,
  Select,
  SelectItem,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Popover,
  PopoverTrigger,
  PopoverContent,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  Button,
} from "@/design-system";

function renderDS(ui: ReactNode) {
  return render(
    <ThemeProvider defaultTheme="light">
      <DesignSystemProvider>{ui}</DesignSystemProvider>
    </ThemeProvider>
  );
}

describe("Select (molecule)", () => {
  it("renders the selected option's label", () => {
    renderDS(
      <Select value="a" aria-label="Fruit">
        <SelectItem value="a">Apple</SelectItem>
        <SelectItem value="b">Banana</SelectItem>
      </Select>
    );
    expect(screen.getByText("Apple")).toBeInTheDocument();
  });
});

describe("Tabs (molecule)", () => {
  it("shows the active panel and switches on click", async () => {
    renderDS(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">First panel</TabsContent>
        <TabsContent value="two">Second panel</TabsContent>
      </Tabs>
    );
    expect(screen.getByText("First panel")).toBeInTheDocument();
    expect(screen.queryByText("Second panel")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Two" }));
    expect(screen.getByText("Second panel")).toBeInTheDocument();
  });
});

describe("Popover (molecule)", () => {
  it("opens content on trigger click", async () => {
    renderDS(
      <Popover>
        <PopoverTrigger>
          <Button>Open</Button>
        </PopoverTrigger>
        <PopoverContent>Popover body</PopoverContent>
      </Popover>
    );
    expect(screen.queryByText("Popover body")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByText("Popover body")).toBeInTheDocument();
  });
});

describe("DropdownMenu (molecule)", () => {
  it("opens items on trigger click", async () => {
    renderDS(
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Button>Menu</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Edit</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
  });
});

describe("AlertDialog (organism)", () => {
  it("opens on trigger and shows its title", async () => {
    renderDS(
      <AlertDialog>
        <AlertDialogTrigger>
          <Button>Delete</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Delete project?</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete project?")).toBeInTheDocument();
  });
});

describe("Sheet (organism)", () => {
  it("opens the drawer on trigger and shows its title", async () => {
    renderDS(
      <Sheet>
        <SheetTrigger>
          <Button>Open sheet</Button>
        </SheetTrigger>
        <SheetContent side="right">
          <SheetTitle>Filters</SheetTitle>
        </SheetContent>
      </Sheet>
    );
    await userEvent.click(screen.getByRole("button", { name: "Open sheet" }));
    expect(screen.getByText("Filters")).toBeInTheDocument();
  });
});
