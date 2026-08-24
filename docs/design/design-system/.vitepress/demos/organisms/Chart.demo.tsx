import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/design-system/keep-lib";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

const data = [
  { month: "Jan", signups: 42 },
  { month: "Feb", signups: 58 },
  { month: "Mar", signups: 51 },
  { month: "Apr", signups: 73 },
  { month: "May", signups: 66 },
];

const config = { signups: { label: "Signups", color: "hsl(209, 100%, 33%)" } };

export default function ChartDemo() {
  return (
    <div style={{ width: 380, height: 220 }}>
      <ChartContainer config={config}>
        <BarChart data={data}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="month" tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="signups" fill="var(--color-signups)" radius={4} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
