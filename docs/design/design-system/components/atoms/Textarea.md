# Textarea (atom)

Multiline field on MUI `OutlinedInput multiline`. **Replaces** `src/components/ui/textarea.tsx`.

- **Layer:** atom · **Status:** WRAP · **Import:** `import { Textarea } from "@/design-system"`

## Live demo

<Demo name="Textarea" />

## API

Full MUI `OutlinedInputProps`. Defaults: `fullWidth` = true, `minRows` = 3. `error` → destructive border.

## Behavior (→ tests)

- Renders a `<textarea>` textbox reflecting its value.

## Usage

```tsx
<Textarea placeholder="A few words…" minRows={4} />
```
