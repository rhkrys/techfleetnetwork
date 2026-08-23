import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import {
  DesignSystemProvider,
  Breadcrumb,
  BreadcrumbLink,
  BreadcrumbPage,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  CollapsibleContent,
  Pagination,
} from "@/design-system";

function renderDS(ui: ReactNode) {
  return render(
    <ThemeProvider defaultTheme="light">
      <DesignSystemProvider>{ui}</DesignSystemProvider>
    </ThemeProvider>
  );
}

describe("Phase 3 molecules", () => {
  it("Breadcrumb renders links and current page", () => {
    renderDS(
      <Breadcrumb>
        <BreadcrumbLink href="/">Home</BreadcrumbLink>
        <BreadcrumbPage>Current</BreadcrumbPage>
      </Breadcrumb>
    );
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("Accordion renders trigger and expanded content", () => {
    renderDS(
      <Accordion>
        <AccordionItem defaultExpanded>
          <AccordionTrigger>Section</AccordionTrigger>
          <AccordionContent>Body</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    expect(screen.getByText("Section")).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("CollapsibleContent shows children when open", () => {
    renderDS(<CollapsibleContent open>Panel</CollapsibleContent>);
    expect(screen.getByText("Panel")).toBeInTheDocument();
  });

  it("Pagination renders navigable pages", () => {
    renderDS(<Pagination count={5} page={1} />);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /page 2/i })).toBeInTheDocument();
  });
});
