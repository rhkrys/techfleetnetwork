import { useState } from "react";
import { Calendar } from "@/design-system/keep-lib";

export default function CalendarDemo() {
  const [date, setDate] = useState<Date | undefined>(new Date());
  return <Calendar mode="single" selected={date} onSelect={setDate} />;
}
