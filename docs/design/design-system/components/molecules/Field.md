# Field (molecule)

Label + control + error/helper text — the presentational glue for forms. **Replaces** the shadcn
`form.tsx` `FormItem`/`FormLabel`/`FormMessage` scaffolding.

- **Layer:** molecule · **Status:** BUILD · **Import:** `import { Field } from "@/design-system"`

## Live demo

<Demo name="Field" />

## API

| Prop         | Type        | Notes                                                           |
| ------------ | ----------- | --------------------------------------------------------------- |
| `label`      | `ReactNode` | Rendered as `<Label htmlFor>`.                                  |
| `htmlFor`    | `string`    | Binds label → control.                                          |
| `required`   | `boolean`   | Appends ` *`.                                                   |
| `error`      | `string`    | Shown in destructive color; takes precedence over `helperText`. |
| `helperText` | `ReactNode` | Muted helper below the control.                                 |
| `children`   | `ReactNode` | The control (Input, Select, …).                                 |

## Usage

```tsx
<Field label="Email" htmlFor="email" error={errors.email?.message}>
  <Input id="email" />
</Field>
```

The RHF adapters (`RHFTextField`, …) wrap this — prefer them for react-hook-form.
