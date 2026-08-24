import { Stepper, Step, StepLabel } from "@/design-system";

export default function StepperDemo() {
  return (
    <Stepper activeStep={1} sx={{ width: "100%" }}>
      <Step>
        <StepLabel>Account</StepLabel>
      </Step>
      <Step>
        <StepLabel>Profile</StepLabel>
      </Step>
      <Step>
        <StepLabel>Review</StepLabel>
      </Step>
    </Stepper>
  );
}
