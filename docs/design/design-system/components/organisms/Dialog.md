# Dialog (organism)

MUI `Dialog` + sub-parts. **Replaces** `src/components/ui/dialog.tsx`.

- **Layer:** organism · **Status:** WRAP · **Import:** `import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent, DialogFooter } from "@/design-system"`

## API differs from shadcn (controlled, not trigger-based)

The shadcn/Radix Dialog was trigger-driven (`DialogTrigger`/`DialogPortal`/`DialogClose`, `open`/`onOpenChange`).
**MUI Dialog is controlled** — drive it with your own `open` state and `onClose`. There is no `DialogTrigger`
or `DialogClose`; render your own buttons.

| Export              | Maps to                                        |
| ------------------- | ---------------------------------------------- |
| `Dialog`            | MUI `Dialog` (`open`, `onClose`)               |
| `DialogTitle`       | MUI `DialogTitle` + `<Text brand="cardTitle">` |
| `DialogDescription` | muted `<Text>`                                 |
| `DialogContent`     | MUI `DialogContent`                            |
| `DialogFooter`      | MUI `DialogActions`                            |
| `DialogHeader`      | grouping box                                   |

Paper: 8px radius, `divider` border, `paper` surface (theme `MuiDialog`).

## Behavior (→ tests)

- `open` → renders `role="dialog"` with title + content; `open={false}` → nothing rendered.

## Usage

```tsx
const [open, setOpen] = useState(false);
<Button onClick={() => setOpen(true)}>Open</Button>
<Dialog open={open} onClose={() => setOpen(false)}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Delete project?</DialogTitle>
      <DialogDescription>This action cannot be undone.</DialogDescription>
    </DialogHeader>
  </DialogContent>
  <DialogFooter>
    <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    <Button variant="destructive" onClick={confirm}>Delete</Button>
  </DialogFooter>
</Dialog>
```
