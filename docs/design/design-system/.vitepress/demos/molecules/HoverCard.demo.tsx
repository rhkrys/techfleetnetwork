import { HoverCard, HoverCardTrigger, HoverCardContent, Button } from "@/design-system";

export default function HoverCardDemo() {
  return (
    <HoverCard>
      <HoverCardTrigger>
        <Button variant="link">@techfleet</Button>
      </HoverCardTrigger>
      <HoverCardContent>
        <div style={{ padding: 12, maxWidth: 240 }}>
          <strong>Tech Fleet</strong>
          <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>
            A community teaching real-world tech skills through hands-on projects.
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
