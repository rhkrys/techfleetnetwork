import { Badge, Button } from "@/design-system";

import { Eye } from "lucide-react";

interface ResourceCardProps {
  name: string;
  category: string;
  categoryColorClass: string;
  description: string;
  onView: () => void;
}

export default function ResourceCard({
  name,
  category,
  categoryColorClass,
  description,
  onView,
}: ResourceCardProps) {
  return (
    <div className="group rounded-lg border bg-card text-card-foreground shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden flex flex-col">
      {/* Color band top */}
      <div className="h-28 bg-muted flex items-center justify-center px-4">
        <p className="text-sm font-semibold text-muted-foreground text-center leading-snug line-clamp-3">
          {name}
        </p>
      </div>

      <div className="p-4 flex flex-col flex-1 gap-3">
        <Badge variant="outline" className={`w-fit text-xs ${categoryColorClass}`}>
          {category}
        </Badge>

        <p className="text-sm text-muted-foreground line-clamp-2 flex-1">{description}</p>

        <Button size="sm" variant="outline" className="w-full mt-auto" onClick={onView}>
          View
        </Button>
      </div>
    </div>
  );
}
