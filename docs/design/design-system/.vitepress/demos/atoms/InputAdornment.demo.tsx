import { TextField, InputAdornment } from "@/design-system";
import Search from "@mui/icons-material/Search";

export default function InputAdornmentDemo() {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", maxWidth: 280 }}
    >
      <TextField
        label="Amount"
        InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
      />
      <TextField
        label="Search"
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Search fontSize="small" />
            </InputAdornment>
          ),
        }}
      />
    </div>
  );
}
