import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Button,
} from "@/design-system";

export default function CardDemo() {
  return (
    <Card style={{ maxWidth: 340 }}>
      <CardHeader>
        <CardTitle>Project kickoff</CardTitle>
        <CardDescription>Everything you need to get started.</CardDescription>
      </CardHeader>
      <CardContent>
        The Tech Fleet card surface — 40px asymmetric radius and an inset brand glow, straight from
        the theme.
      </CardContent>
      <CardFooter style={{ gap: 12 }}>
        <Button variant="hero">Start</Button>
        <Button variant="ghost">Later</Button>
      </CardFooter>
    </Card>
  );
}
