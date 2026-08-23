import { useState } from "react";
import { MobileStepper, Button } from "@/design-system";

export default function MobileStepperDemo() {
  const [step, setStep] = useState(0);
  return (
    <MobileStepper
      variant="dots"
      steps={5}
      position="static"
      activeStep={step}
      sx={{ maxWidth: 360, flexGrow: 1 }}
      nextButton={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setStep((s) => Math.min(4, s + 1))}
          disabled={step === 4}
        >
          Next
        </Button>
      }
      backButton={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          Back
        </Button>
      }
    />
  );
}
