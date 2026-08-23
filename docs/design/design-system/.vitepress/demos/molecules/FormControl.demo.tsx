import {
  FormControl,
  FormLabel,
  FormGroup,
  FormControlLabel,
  FormHelperText,
  Checkbox,
} from "@/design-system";

export default function FormControlDemo() {
  return (
    <FormControl component="fieldset" variant="standard">
      <FormLabel component="legend">Notifications</FormLabel>
      <FormGroup>
        <FormControlLabel control={<Checkbox defaultChecked />} label="Email" />
        <FormControlLabel control={<Checkbox />} label="SMS" />
        <FormControlLabel control={<Checkbox />} label="Push" />
      </FormGroup>
      <FormHelperText>Choose how we should reach you.</FormHelperText>
    </FormControl>
  );
}
