# Label (atom)

Form label (styled `<label>`). **Replaces** `src/components/ui/label.tsx`.

- **Layer:** atom · **Status:** WRAP (styled) · **Import:** `import { Label } from "@/design-system"`

## Live demo

<Demo name="Label" />

## API

Intrinsic `<label>` props — use `htmlFor` to bind to a field's `id`. Poppins 600 / 14px.

## Usage

```tsx
<Label htmlFor="email">Email</Label>
<Input id="email" />
```

## Note

For fields with built-in labels, the Phase-2 `RHFTextField` will own label + error together; this atom is for
standalone label + control pairs.
