import { CalendarPlus, Copy, ExternalLink, Mail, MapPin, Video } from "lucide-react";
import { Button } from "@/design-system";

import { toast } from "@/hooks/use-toast";
import { sanitizeHtml } from "@/lib/security";
import { linkifyHtml } from "@/lib/linkify";
import { formatEventTime } from "@/lib/events/formatEventTime";
import { buildGoogleCalendarTemplateUrl } from "@/lib/events/googleCalendarTemplate";

export interface CommunityEvent {
  uid: string;
  title: string;
  startUtc: string;
  endUtc: string;
  allDay: boolean;
  description: string;
  location: string;
  url: string;
  organizerEmail: string;
}

interface Props {
  event: CommunityEvent;
  timeZone: string;
}

// Detect a meeting URL inside location/description/url for the "Join" button
const URL_RE = /(https?:\/\/[^\s<>"')]+)/i;
function extractMeetingUrl(ev: CommunityEvent): string | null {
  if (ev.url && URL_RE.test(ev.url)) return ev.url.match(URL_RE)![0];
  if (ev.location && URL_RE.test(ev.location)) return ev.location.match(URL_RE)![0];
  if (ev.description && URL_RE.test(ev.description)) return ev.description.match(URL_RE)![0];
  return null;
}

export function CommunityEventCard({ event, timeZone }: Props) {
  const time = formatEventTime(event.startUtc, event.endUtc, timeZone, event.allDay);
  const addUrl = buildGoogleCalendarTemplateUrl(event);
  const meetingUrl = extractMeetingUrl(event);
  const isVideoLink =
    meetingUrl && /(meet\.google|zoom\.us|teams\.microsoft|whereby|webex)/i.test(meetingUrl);

  // Description: escape via linkify (which html-escapes text) then sanitize.
  const descriptionHtml = event.description ? sanitizeHtml(linkifyHtml(event.description)) : "";

  const copyLink = async () => {
    if (!meetingUrl) return;
    try {
      await navigator.clipboard.writeText(meetingUrl);
      toast({ title: "Link copied", description: "Event link copied to your clipboard." });
    } catch {
      toast({ title: "Copy failed", description: meetingUrl, variant: "destructive" });
    }
  };

  return (
    <article className="rounded-lg border bg-card p-4 sm:p-5 transition-colors hover:border-primary/40 focus-within:border-primary/60">
      <header className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold text-foreground leading-tight">
            {event.title}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            <time dateTime={time.iso}>{time.primary}</time>
          </p>
        </div>
        {time.relative && (
          <span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            {time.relative}
          </span>
        )}
      </header>

      {(event.location || event.organizerEmail) && (
        <ul className="mb-3 space-y-1 text-xs text-muted-foreground">
          {event.location && !URL_RE.test(event.location) && (
            <li className="flex items-start gap-1.5">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="break-words">{event.location}</span>
            </li>
          )}
          {event.organizerEmail && (
            <li className="flex items-start gap-1.5">
              <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <a
                href={`mailto:${event.organizerEmail}`}
                className="text-primary hover:underline break-all"
              >
                {event.organizerEmail}
              </a>
            </li>
          )}
        </ul>
      )}

      {descriptionHtml && (
        <div
          className="prose prose-sm max-w-none text-sm text-foreground/90 [&_a]:text-primary [&_a]:underline whitespace-pre-wrap break-words mb-4"
          dangerouslySetInnerHTML={{ __html: descriptionHtml }}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="default">
          <a
            href={addUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Add ${event.title} to your Google Calendar`}
          >
            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
            Add to Google Calendar
          </a>
        </Button>
        {meetingUrl && (
          <Button asChild size="sm" variant="outline">
            <a
              href={meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Join ${event.title}`}
            >
              {isVideoLink ? (
                <Video className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              )}
              {isVideoLink ? "Join meeting" : "Open link"}
            </a>
          </Button>
        )}
        {meetingUrl && (
          <Button
            size="sm"
            variant="ghost"
            onClick={copyLink}
            aria-label={`Copy event link for ${event.title}`}
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copy link
          </Button>
        )}
      </div>
    </article>
  );
}
