import { Alert, AlertTitle, AlertDescription } from "@/design-system";

export default function AlertDemo() {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 420 }}
    >
      <Alert variant="info">
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>This is an informational message.</AlertDescription>
      </Alert>
      <Alert variant="success">
        <AlertTitle>Saved</AlertTitle>
        <AlertDescription>Your changes were saved.</AlertDescription>
      </Alert>
      <Alert variant="warning">Double-check before continuing.</Alert>
      <Alert variant="destructive">
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription>We couldn&apos;t complete that request.</AlertDescription>
      </Alert>
    </div>
  );
}
