/**
 * DS Showcase — the visual-regression + review surface for TFDS (Phase 0).
 * Renders every built atom/molecule so `npm run test:visual` can snapshot them
 * in light + dark, and so reviewers can eyeball brand fidelity vs shadcn.
 * Route: /admin/design-system (admin-gated, non-critical).
 */
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  Button,
  Card,
  CardHeader,
  CardContent,
  CardFooter,
  CardTitle,
  CardDescription,
  Text,
  Icon,
  Badge,
  Label,
  Input,
  Textarea,
  Checkbox,
  Switch,
  Skeleton,
  Separator,
  Alert,
  AlertTitle,
  AlertDescription,
  Tooltip,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
  RHFTextField,
  RHFCheckbox,
  type TfButtonVariant,
  type TfButtonSize,
  type TextBrand,
  type BadgeVariant,
  type AlertVariant,
} from "@/design-system";
import Add from "@mui/icons-material/Add";
import ArrowForward from "@mui/icons-material/ArrowForward";
import InfoOutlined from "@mui/icons-material/InfoOutlined";

const ALERT_VARIANTS: AlertVariant[] = ["default", "success", "warning", "destructive"];

function RhfFormDemo() {
  const { control } = useForm<{ email: string; agree: boolean }>({
    defaultValues: { email: "", agree: false },
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 360 }}>
      <RHFTextField name="email" control={control} label="Email" placeholder="you@example.com" />
      <RHFCheckbox name="agree" control={control} label="Subscribe to updates" />
    </div>
  );
}

function DialogDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open dialog
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project?</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>
        </DialogContent>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => setOpen(false)}>
            Delete
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

const VARIANTS: TfButtonVariant[] = [
  "default",
  "hero",
  "success",
  "destructive",
  "outline",
  "secondary",
  "hero-outline",
  "ghost",
  "link",
];
const SIZES: TfButtonSize[] = ["default", "sm", "lg", "xl", "icon"];
const BADGE_VARIANTS: BadgeVariant[] = ["default", "secondary", "destructive", "outline"];
const BRANDS: TextBrand[] = [
  "display",
  "pageTitle",
  "sectionTitle",
  "subsectionTitle",
  "cardTitle",
  "eyebrow",
  "lede",
  "label",
  "body",
  "bodySmall",
  "caption",
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "3rem" }} data-dsr-section={title}>
      <Text brand="sectionTitle" as="h2" sx={{ mb: 2 }}>
        {title}
      </Text>
      {children}
    </section>
  );
}

export default function DesignSystemShowcasePage() {
  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1rem" }}>
      <Text brand="pageTitle" as="h1" sx={{ mb: 1 }}>
        Tech Fleet Design System
      </Text>
      <Text brand="lede" color="muted" sx={{ mb: 4 }}>
        Phase 0 — atoms and molecules on MUI Core. Toggle light/dark to check fidelity.
      </Text>

      <Section title="Typography">
        {BRANDS.map((brand) => (
          <div key={brand} style={{ marginBottom: "0.5rem" }}>
            <Text brand={brand}>{brand} — The quick brown fox jumps over the lazy dog</Text>
          </div>
        ))}
      </Section>

      <Section title="Buttons — variants">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          {VARIANTS.map((v) => (
            <Button key={v} variant={v}>
              {v}
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Buttons — sizes & states">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          {SIZES.map((s) => (
            <Button key={s} size={s} variant="default">
              {s === "icon" ? <Icon icon={Add} label="Add" /> : s}
            </Button>
          ))}
          <Button variant="default" disabled>
            disabled
          </Button>
          <Button variant="default" endIcon={<Icon icon={ArrowForward} />}>
            with icon
          </Button>
        </div>
      </Section>

      <Section title="Card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
          <Card style={{ maxWidth: 320 }}>
            <CardHeader>
              <CardTitle>Default card</CardTitle>
              <CardDescription>Asymmetric 40px radius, inset glow.</CardDescription>
            </CardHeader>
            <CardContent>
              <Text brand="body">Body content inside the tf-card surface.</Text>
            </CardContent>
            <CardFooter>
              <Button variant="outline" size="sm">
                Action
              </Button>
            </CardFooter>
          </Card>
          <Card variant="compact" style={{ maxWidth: 280 }}>
            <CardHeader>
              <CardTitle>Compact card</CardTitle>
            </CardHeader>
            <CardContent>
              <Text brand="bodySmall" color="muted">
                24px radius variant.
              </Text>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title="Badges">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {BADGE_VARIANTS.map((v) => (
            <Badge key={v} variant={v}>
              {v}
            </Badge>
          ))}
        </div>
      </Section>

      <Section title="Form atoms">
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 360 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            <Label htmlFor="dsr-name">Name</Label>
            <Input id="dsr-name" placeholder="Ada Lovelace" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            <Label htmlFor="dsr-email">Email (error state)</Label>
            <Input id="dsr-email" placeholder="you@example.com" error defaultValue="not-an-email" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            <Label htmlFor="dsr-bio">Bio</Label>
            <Textarea id="dsr-bio" placeholder="A few words…" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Checkbox id="dsr-agree" defaultChecked />
            <Label htmlFor="dsr-agree">I agree</Label>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Switch id="dsr-notify" defaultChecked />
            <Label htmlFor="dsr-notify">Notifications</Label>
          </div>
        </div>
      </Section>

      <Section title="Feedback">
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: 360 }}>
          <Skeleton height={20} />
          <Skeleton height={20} width="60%" />
          <Separator />
          <Text brand="bodySmall" color="muted">
            A separator sits above this line.
          </Text>
        </div>
      </Section>

      <Section title="Alerts">
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: 480 }}>
          {ALERT_VARIANTS.map((v) => (
            <Alert key={v} variant={v}>
              <AlertTitle>{v}</AlertTitle>
              <AlertDescription>An {v} alert message.</AlertDescription>
            </Alert>
          ))}
        </div>
      </Section>

      <Section title="Tooltip">
        <Tooltip title="Extra context on hover">
          <Button variant="outline">
            <Icon icon={InfoOutlined} /> Hover me
          </Button>
        </Tooltip>
      </Section>

      <Section title="Form field layer (react-hook-form)">
        <RhfFormDemo />
      </Section>

      <Section title="Dialog">
        <DialogDemo />
      </Section>
    </div>
  );
}
