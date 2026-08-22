/**
 * DS Showcase — the visual-regression + review surface for TFDS (Phase 0).
 * Renders every built atom/molecule so `npm run test:visual` can snapshot them
 * in light + dark, and so reviewers can eyeball brand fidelity vs shadcn.
 * Route: /admin/design-system (admin-gated, non-critical).
 */
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
  type TfButtonVariant,
  type TfButtonSize,
  type TextBrand,
  type BadgeVariant,
} from "@/design-system";
import Add from "@mui/icons-material/Add";
import ArrowForward from "@mui/icons-material/ArrowForward";

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
    </div>
  );
}
