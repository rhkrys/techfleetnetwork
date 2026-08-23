import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/design-system";

export default function CommandDemo() {
  return (
    <Command style={{ border: "1px solid var(--vp-c-divider)", borderRadius: 8, width: 320 }}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Suggestions">
          <CommandItem>Open calendar</CommandItem>
          <CommandItem>Search projects</CommandItem>
          <CommandItem>Go to settings</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
