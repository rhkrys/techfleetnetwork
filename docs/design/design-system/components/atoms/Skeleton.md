# Skeleton (atom)

MUI `Skeleton` (rounded, pulse). **Replaces** `src/components/ui/skeleton.tsx`.

- **Layer:** atom · **Status:** WRAP · **Import:** `import { Skeleton } from "@/design-system"`

## Live demo

<Demo name="Skeleton" />

## API

Full MUI `SkeletonProps`. Default `variant` = `rounded`, `animation` = `pulse` (theme). Size via `width`/`height`.

## Deviation from stock MUI

- 6px radius + a subtle theme-tinted surface (matches shadcn's `bg-muted animate-pulse`).

## Usage

```tsx
<Skeleton height={20} />
<Skeleton height={20} width="60%" />
<Skeleton variant="circular" width={40} height={40} />
```
