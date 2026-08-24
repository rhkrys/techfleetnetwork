import { Badge, Button, Separator } from "@/design-system";

import { Pencil, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import type { AppFormData } from "@/lib/validators/general-application";
import { SECTION_TITLES, getFieldErrors } from "@/lib/validators/general-application";

interface Props {
  form: AppFormData;
  onEditSection: (section: number) => void;
}

/** Reusable review field row */
function ReviewField({
  label,
  value,
  empty,
}: {
  label: string;
  value: React.ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <span className={cn("text-sm text-foreground", empty && "text-muted-foreground italic")}>
        {empty ? "Not provided" : value}
      </span>
    </div>
  );
}

function formatChoice(val: string): string {
  if (val === "yes") return "Yes";
  if (val === "no") return "No";
  if (val === "not_sure") return "I'm not sure";
  return val;
}

function ReviewSection({
  sectionNumber,
  title,
  children,
  hasErrors,
  onEdit,
}: {
  sectionNumber: number;
  title: string;
  children: React.ReactNode;
  hasErrors: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-foreground">
            Section {sectionNumber}: {title}
          </h3>
          {hasErrors ? (
            <Badge variant="destructive" className="text-xs gap-1">
              <AlertCircle className="h-3 w-3" /> Incomplete
            </Badge>
          ) : (
            <Badge
              variant="secondary"
              className="text-xs gap-1 bg-success/10 text-success border-success/30"
            >
              <CheckCircle2 className="h-3 w-3" /> Complete
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onEdit} className="gap-1.5 text-xs">
          <Pencil className="h-3 w-3" /> Edit
        </Button>
      </div>
      <div className="space-y-3 pl-1">{children}</div>
    </div>
  );
}

/** Section 6: Review — read-only summary of all sections */
export function SectionReview({ form, onEditSection }: Props) {
  const { profile } = useAuth();
  const s1Errors = Object.keys(getFieldErrors(form, 1)).length > 0;
  const s2Errors = Object.keys(getFieldErrors(form, 2)).length > 0;
  const s3Errors = Object.keys(getFieldErrors(form, 3)).length > 0;
  const s4Errors = Object.keys(getFieldErrors(form, 4)).length > 0;
  const s5Errors = Object.keys(getFieldErrors(form, 5)).length > 0;

  const totalIncomplete = [s1Errors, s2Errors, s3Errors, s4Errors, s5Errors].filter(Boolean).length;

  // Discord link status reads from the verified profile (source of truth),
  // never from the form's free-text field — which no longer exists.
  const discordLinked = Boolean(profile?.discord_user_id);
  const discordLabel = discordLinked
    ? profile?.discord_username
      ? `Linked as @${profile.discord_username}`
      : "Linked to Discord"
    : "Not linked";

  return (
    <div className="space-y-6" role="region" aria-label="Application review">
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">
          Please review your application below before submitting. Click <strong>Edit</strong> on any
          section to make changes.
        </p>
        {totalIncomplete > 0 && (
          <p className="text-sm text-destructive mt-2 flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {totalIncomplete} {totalIncomplete === 1 ? "section needs" : "sections need"} to be
            completed before you can submit.
          </p>
        )}
      </div>

      {/* Section 1: Intro */}
      <ReviewSection
        sectionNumber={1}
        title={SECTION_TITLES[0]}
        hasErrors={s1Errors}
        onEdit={() => onEditSection(1)}
      >
        <ReviewField
          label="Hours Commitment (15–20 hrs/week)"
          value={formatChoice(form.hours_commitment)}
          empty={!form.hours_commitment}
        />
        <ReviewField label="Portfolio URL" value={form.portfolio_url} empty={!form.portfolio_url} />
        <ReviewField label="LinkedIn URL" value={form.linkedin_url} empty={!form.linkedin_url} />
      </ReviewSection>

      <Separator />

      {/* Section 2: Profile */}
      <ReviewSection
        sectionNumber={2}
        title={SECTION_TITLES[1]}
        hasErrors={s2Errors}
        onEdit={() => onEditSection(2)}
      >
        <ReviewField label="Country" value={form.country} empty={!form.country} />
        <ReviewField label="Timezone" value={form.timezone} empty={!form.timezone} />
        <ReviewField label="Discord Account" value={discordLabel} empty={!discordLinked} />
        <ReviewField
          label="Experience Areas"
          value={form.experience_areas.length > 0 ? form.experience_areas.join(", ") : undefined}
          empty={form.experience_areas.length === 0}
        />
        <ReviewField
          label="Professional Goals"
          value={form.professional_goals}
          empty={!form.professional_goals}
        />
        <ReviewField
          label="Education Background"
          value={
            form.education_background.length > 0 ? form.education_background.join(", ") : undefined
          }
          empty={form.education_background.length === 0}
        />
        <ReviewField
          label="Activity Interests"
          value={form.interests.length > 0 ? form.interests.join(", ") : undefined}
          empty={form.interests.length === 0}
        />
        <ReviewField
          label="Scheduling Link"
          value={form.scheduling_url}
          empty={!form.scheduling_url}
        />
        <ReviewField
          label="Notification Preferences"
          value={
            [
              form.notify_training_opportunities && "Training opportunities",
              form.notify_announcements && "Announcements",
            ]
              .filter(Boolean)
              .join(", ") || "None selected"
          }
        />
      </ReviewSection>

      <Separator />

      {/* Section 3: Engagement */}
      <ReviewSection
        sectionNumber={3}
        title={SECTION_TITLES[2]}
        hasErrors={s3Errors}
        onEdit={() => onEditSection(3)}
      >
        <ReviewField
          label="Previously Engaged with Tech Fleet"
          value={formatChoice(form.previous_engagement)}
          empty={!form.previous_engagement}
        />
        {form.previous_engagement === "yes" && (
          <>
            <ReviewField
              label="Engagement Ways"
              value={
                form.previous_engagement_ways.length > 0
                  ? form.previous_engagement_ways.join(", ")
                  : undefined
              }
              empty={form.previous_engagement_ways.length === 0}
            />
            <ReviewField
              label="Teammate Learnings"
              value={form.teammate_learnings}
              empty={!form.teammate_learnings}
            />
          </>
        )}
      </ReviewSection>

      <Separator />

      {/* Section 4: Agile */}
      <ReviewSection
        sectionNumber={4}
        title={SECTION_TITLES[3]}
        hasErrors={s4Errors}
        onEdit={() => onEditSection(4)}
      >
        <ReviewField
          label="Agile vs Waterfall"
          value={form.agile_vs_waterfall}
          empty={!form.agile_vs_waterfall}
        />
        <ReviewField
          label="Psychological Safety"
          value={form.psychological_safety}
          empty={!form.psychological_safety}
        />
        <ReviewField
          label="Agile Philosophies"
          value={form.agile_philosophies}
          empty={!form.agile_philosophies}
        />
        <ReviewField
          label="Collaboration Challenges"
          value={form.collaboration_challenges}
          empty={!form.collaboration_challenges}
        />
      </ReviewSection>

      <Separator />

      {/* Section 5: Service Leadership */}
      <ReviewSection
        sectionNumber={5}
        title={SECTION_TITLES[4]}
        hasErrors={s5Errors}
        onEdit={() => onEditSection(5)}
      >
        <ReviewField
          label="Service Leadership Definition"
          value={form.service_leadership_definition}
          empty={!form.service_leadership_definition}
        />
        <ReviewField
          label="Service Leadership Actions"
          value={form.service_leadership_actions}
          empty={!form.service_leadership_actions}
        />
        <ReviewField
          label="Service Leadership Challenges"
          value={form.service_leadership_challenges}
          empty={!form.service_leadership_challenges}
        />
        <ReviewField
          label="Service Leadership Situation"
          value={form.service_leadership_situation}
          empty={!form.service_leadership_situation}
        />
      </ReviewSection>
    </div>
  );
}
