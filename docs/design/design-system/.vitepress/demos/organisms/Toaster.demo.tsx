import { Button } from "@/design-system";
import { toast, Toaster } from "@/design-system/keep-lib";

export default function ToasterDemo() {
  return (
    <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Button variant="outline" onClick={() => toast("Event created")}>
          Default
        </Button>
        <Button variant="success" onClick={() => toast.success("Changes saved")}>
          Success
        </Button>
        <Button variant="destructive" onClick={() => toast.error("Something went wrong")}>
          Error
        </Button>
      </div>
      <Toaster />
    </>
  );
}
