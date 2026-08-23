import { SvgIcon } from "@/design-system";

export default function SvgIconDemo() {
  return (
    <>
      <SvgIcon>
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
      </SvgIcon>
      <SvgIcon color="primary" fontSize="large">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
      </SvgIcon>
      <SvgIcon color="success" sx={{ fontSize: 48 }}>
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
      </SvgIcon>
    </>
  );
}
