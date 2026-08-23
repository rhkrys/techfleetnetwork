import { Text } from "@/design-system";

export default function TextDemo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Text brand="display">Display</Text>
      <Text brand="pageTitle">Page title</Text>
      <Text brand="sectionTitle">Section title</Text>
      <Text brand="cardTitle">Card title</Text>
      <Text brand="eyebrow" color="primary">
        EYEBROW
      </Text>
      <Text brand="lede">A lede paragraph introduces the section with a slightly larger size.</Text>
      <Text brand="body">Body text — the default paragraph style (Poppins).</Text>
      <Text brand="bodySmall" color="muted">
        Body small, muted — for secondary details.
      </Text>
      <Text brand="caption" color="muted">
        Caption 12px
      </Text>
    </div>
  );
}
