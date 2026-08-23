import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
  Button,
} from "@/design-system";

export default function SheetDemo() {
  return (
    <Sheet>
      <SheetTrigger>
        <Button variant="outline">Open filters</Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Narrow the results shown in the list.</SheetDescription>
        </SheetHeader>
        <div style={{ marginTop: 16 }}>Filter controls go here.</div>
        <SheetClose>Done</SheetClose>
      </SheetContent>
    </Sheet>
  );
}
