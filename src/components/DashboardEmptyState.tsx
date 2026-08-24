import { LayoutDashboard, Settings2 } from "lucide-react";
import { Button } from "@/design-system";

interface DashboardEmptyStateProps {
  onCustomize: () => void;
}

export function DashboardEmptyState({ onCustomize }: DashboardEmptyStateProps) {
  return (
    <div className="tf-card flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
        <LayoutDashboard className="h-8 w-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">Make this dashboard yours</h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        Choose which sections to display so you see exactly what matters to you.
      </p>
      <Button onClick={onCustomize} className="gap-2">
        <Settings2 className="h-4 w-4" />
        Customize Dashboard
      </Button>
    </div>
  );
}
