// Shared, compact "Sources" disclosure for Fleety answers, used identically by all three chat
// surfaces. COLLAPSED BY DEFAULT so the ANSWER — not a block of links — is what a member sees
// when a reply lands (the "Fleety only sent links" confusion was the sources block filling the
// viewport and hiding the answer above it). One click expands the deduped, human-labeled list.
import { dedupeSources, formatSourceLabel } from "@/lib/fleety/sources";

export function FleetySources({ urls }: { urls?: string[] | null }) {
  const items = dedupeSources(urls ?? []);
  if (!items.length) return null;

  return (
    <details className="mt-3 border-t border-border/50 pt-2">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
        <span aria-hidden="true">📚</span>
        <span>
          {items.length} source{items.length === 1 ? "" : "s"}
        </span>
        <span className="font-normal opacity-60">— tap to view</span>
      </summary>
      <ul className="mt-1.5 space-y-0.5">
        {items.map((url) => (
          <li key={url}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              {formatSourceLabel(url)}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
