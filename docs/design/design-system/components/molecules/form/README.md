# Form field layer — react-hook-form adapters

The shadcn `form.tsx` used a Radix `Slot` (`asChild`) to inject `aria-*` into a child input — incompatible
with MUI inputs, which own their own label/error/helper model. These adapters replace it: each binds a DS
atom to **react-hook-form** via `useController` and renders through `Field` (label + error).

- **Layer:** molecules · **Status:** BUILD · **Import:** `import { RHFTextField, RHFTextarea, RHFCheckbox, RHFSwitch } from "@/design-system"`

## Live demo

<Demo name="FormAdapters" />

## Components

| Component      | Wraps                       | Notes                                                                      |
| -------------- | --------------------------- | -------------------------------------------------------------------------- |
| `RHFTextField` | `Field` + `Input`           | `error` from `fieldState`; `type`, `placeholder`, `multiline` passthrough. |
| `RHFTextarea`  | `Field` + `Textarea`        | `minRows`, `placeholder`.                                                  |
| `RHFCheckbox`  | `Checkbox` + inline `Label` | Boolean value; error below.                                                |
| `RHFSwitch`    | `Switch` + inline `Label`   | Boolean value.                                                             |

## Shape

```ts
{ name: Path<T>; control: Control<T>; label?: string; helperText?: string; required?: boolean; … }
```

## Usage

```tsx
const { control, handleSubmit } = useForm<FormValues>({ resolver: zodResolver(schema) });

<form onSubmit={handleSubmit(onSubmit)}>
  <RHFTextField name="email" control={control} label="Email" required />
  <RHFTextarea name="bio" control={control} label="Bio" minRows={4} />
  <RHFCheckbox name="agree" control={control} label="I agree" />
  <Button type="submit">Save</Button>
</form>;
```

react-hook-form + zod are retained unchanged; only the field-rendering seam moves to MUI.
