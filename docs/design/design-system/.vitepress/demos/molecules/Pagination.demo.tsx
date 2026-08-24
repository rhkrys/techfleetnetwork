import { useState } from "react";
import { Pagination } from "@/design-system";

export default function PaginationDemo() {
  const [page, setPage] = useState(3);
  return <Pagination count={10} page={page} onChange={(_, p) => setPage(p)} color="primary" />;
}
