import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/design-system";

export default function AccordionDemo() {
  return (
    <div style={{ width: "100%", maxWidth: 420 }}>
      <Accordion>
        <AccordionItem defaultExpanded>
          <AccordionTrigger>What is the Tech Fleet Design System?</AccordionTrigger>
          <AccordionContent>
            An owned component library on MUI Core, themed to the Tech Fleet brand.
          </AccordionContent>
        </AccordionItem>
        <AccordionItem>
          <AccordionTrigger>Is it accessible?</AccordionTrigger>
          <AccordionContent>Yes — components target WCAG 2.2 AA.</AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
