import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SEO } from "@/components/SEO";
import { usePublicCourse } from "@/hooks/use-public-courses";
import { formatCohortDates, trackLabel } from "@/lib/public-course-format";
import type { PublicCohort } from "@/types/public-course";

/**
 * PUBLIC course detail — renders for anonymous visitors.
 * No useAuth(); nothing here is session-gated.
 */
export default function PublicCourseDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: course, isLoading, isError, error } = usePublicCourse(slug);

  const notFound = (error as { status?: number } | null)?.status === 404 || (!isLoading && !isError && !course);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="mt-4 h-10 w-3/4" />
        <Skeleton className="mt-6 h-24 w-full" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
        <SEO title="Course not found" description="This course is not available." canonicalPath="/classes" />
        <h1 className="text-2xl font-bold text-foreground">Course not found</h1>
        <p className="mt-2 text-muted-foreground">
          This course may have been retired, or the link may be incorrect.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/classes">Browse all courses</Link>
        </Button>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-foreground">We couldn't load this course</h1>
        <p className="mt-2 text-muted-foreground">This is usually temporary. Try again in a moment.</p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/classes">Browse all courses</Link>
        </Button>
      </div>
    );
  }

  const outcomes = course!.outcomes ?? [];
  const skills = course!.skills ?? [];
  const prerequisites = course!.prerequisites ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <SEO
        title={course!.title ?? "Course"}
        description={course!.summary ?? "A Tech Fleet course."}
        canonicalPath={`/classes/${course!.slug ?? ""}`}
        ogType="article"
      />

      <nav className="mb-6">
        <Link to="/classes" className="text-sm text-muted-foreground underline hover:text-foreground">
          ← All courses
        </Link>
      </nav>

      <header>
        {course!.track && <Badge variant="secondary" className="mb-3">{trackLabel(course!.track)}</Badge>}
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {course!.title}
        </h1>
        {course!.summary && <p className="mt-3 text-lg text-muted-foreground">{course!.summary}</p>}
      </header>

      {outcomes.length > 0 && (
        <Section title="What you'll learn">
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {outcomes.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </Section>
      )}

      {prerequisites.length > 0 && (
        <Section title="Prerequisites">
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {prerequisites.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </Section>
      )}

      {skills.length > 0 && (
        <Section title="Skills you'll practice">
          <div className="flex flex-wrap gap-2">
            {skills.map((skill, i) => <Badge key={i} variant="outline">{skill}</Badge>)}
          </div>
        </Section>
      )}

      <Section title="Upcoming cohorts">
        {course!.cohorts.length === 0 ? (
          <p className="text-muted-foreground">
            No cohorts are scheduled right now. Check back soon.
          </p>
        ) : (
          <ul className="space-y-4">
            {course!.cohorts.map((cohort) => (
              <li key={cohort.id}>
                <CohortCard cohort={cohort} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="mt-10 rounded-lg border border-border bg-muted/40 p-5">
        <p className="text-sm text-foreground">
          <span className="font-medium">Already a Tech Fleet member?</span>{" "}
          <Link to="/login" className="underline">Sign in</Link> — members get a discount on
          enrollment.
        </p>
      </div>
    </div>
  );
}

function CohortCard({ cohort }: { cohort: PublicCohort }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{cohort.label ?? "Cohort"}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {formatCohortDates(cohort)}
          {cohort.timezone ? ` · ${cohort.timezone}` : ""}
        </p>
        {cohort.registration_url ? (
          <Button asChild className="mt-4">
            {/*
              Opens the Gumroad checkout. `rel="noopener noreferrer"` is required
              with target="_blank": without noopener the destination can reach
              back through window.opener. The URL is allowlisted server-side by
              the serializer, so a non-Gumroad link arrives as null and this
              button is not rendered at all.
            */}
            <a href={cohort.registration_url} target="_blank" rel="noopener noreferrer">
              Enroll on Gumroad
            </a>
          </Button>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            Enrollment for this cohort isn't open yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}
