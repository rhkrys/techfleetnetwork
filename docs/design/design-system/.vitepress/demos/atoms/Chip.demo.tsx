import { Chip, Avatar } from "@/design-system";

export default function ChipDemo() {
  return (
    <>
      <Chip label="Default" />
      <Chip label="Primary" color="primary" />
      <Chip label="Success" color="success" />
      <Chip label="Outlined" variant="outlined" />
      <Chip label="Clickable" onClick={() => {}} />
      <Chip label="Deletable" onDelete={() => {}} />
      <Chip avatar={<Avatar>TF</Avatar>} label="With avatar" />
    </>
  );
}
