/**
 * Accordion (molecule). Replaces src/components/ui/accordion.tsx.
 * MUI Accordion. Compat: AccordionItem=Accordion, AccordionTrigger=AccordionSummary,
 * AccordionContent=AccordionDetails. See components/molecules/Accordion.md
 */
import type { ReactNode } from "react";
import MuiAccordion, { type AccordionProps } from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import ExpandMore from "@mui/icons-material/ExpandMore";

/** shadcn wrapped items in <Accordion type single/multiple>; MUI items are standalone. */
export const Accordion = ({ children }: { children: ReactNode }) => <div>{children}</div>;
export const AccordionItem = (props: AccordionProps) => <MuiAccordion disableGutters {...props} />;
export const AccordionTrigger = ({ children }: { children: ReactNode }) => (
  <AccordionSummary expandIcon={<ExpandMore />}>{children}</AccordionSummary>
);
export const AccordionContent = ({ children }: { children: ReactNode }) => (
  <AccordionDetails>{children}</AccordionDetails>
);

export type { AccordionProps };
