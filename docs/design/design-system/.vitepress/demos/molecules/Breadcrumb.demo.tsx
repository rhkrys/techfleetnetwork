import { Breadcrumb, BreadcrumbLink, BreadcrumbPage } from "@/design-system";

export default function BreadcrumbDemo() {
  return (
    <Breadcrumb>
      <BreadcrumbLink href="#breadcrumb-demo">Home</BreadcrumbLink>
      <BreadcrumbLink href="#breadcrumb-demo">Projects</BreadcrumbLink>
      <BreadcrumbPage>Kickoff</BreadcrumbPage>
    </Breadcrumb>
  );
}
