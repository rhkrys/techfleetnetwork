import { CircularProgress } from "@/design-system";

export default function CircularProgressDemo() {
  return (
    <>
      <CircularProgress />
      <CircularProgress color="secondary" />
      <CircularProgress variant="determinate" value={70} />
      <CircularProgress size={24} />
    </>
  );
}
