import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SEO } from "@/components/SEO";
import { usePublicCourses } from "@/hooks/use-public-courses";
import { formatCohortDates, trackLabel } from "@/lib/public-course-format";
import type { PublicClass } from "@/types/public-course";

/**
 * PUBLIC course catalog — renders for anonymous visitors.
 *
 * Must not depend on AuthProvider: no useAuth(), no session-gated data. The
 * only auth-adjacent element is the sign-in call to action, which is a plain
 * link.
 */
export default function PublicCoursesPage() {
  const { data: courses, isLoading, isError, refetch } = usePublicCourses();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <SEO
        title="Courses"
        description="Browse Tech Fleet courses in agile practice, UX, and product teamwork. Open to everyone — no account required to view."
        canonicalPath="/classes"
      />

      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Courses</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Hands-on training in agile practice, UX, and product teamwork. Browse everything below —
          you don't need an account to look around.
        </p>
      </header>

      {isLoading && <CourseListSkeleton />}

      {isError && (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="font-medium text-foreground">We couldn't load the courses.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This is usually temporary. Try again in a moment.
          </p>
          <Button variant="outline" className="mt-4" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      )}

      {!isLoading && !isError && (courses?.length ?? 0) === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="font-medium text-foreground">No courses are open for enrollment right now.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            New cohorts are announced regularly — check back soon.
          </p>
        </div>
      )}

      {!isLoading && !isError && (courses?.length ?? 0) > 0 && (
        <ul className="grid gap-6 sm:grid-cols-2">
          {courses!.map((course) => (
            <li key={course.id}>
              <CourseCard course={course} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CourseCard({ course }: { course: PublicClass }) {
  const nextCohort = course.cohorts?.[0];
  const href = course.slug ? `/classes/${course.slug}` : null;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        {course.track && (
          <Badge variant="secondary" className="mb-2 w-fit">
            {trackLabel(course.track)}
          </Badge>
        )}
        <CardTitle className="text-xl">{course.title ?? "Untitled course"}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {course.summary && <p className="text-sm text-muted-foreground">{course.summary}</p>}

        {nextCohort && (
          <p className="mt-4 text-sm font-medium text-foreground">
            Next cohort: {formatCohortDates(nextCohort)}
          </p>
        )}

        <div className="mt-auto pt-5">
          {href ? (
            <Button asChild className="w-full">
              <Link to={href}>View course</Link>
            </Button>
          ) : (
            <Button className="w-full" disabled>
              Details coming soon
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CourseListSkeleton() {
  return (
    <div className="grid gap-6 sm:grid-cols-2" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="mb-2 h-5 w-24" />
            <Skeleton className="h-7 w-3/4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-5/6" />
            <Skeleton className="mt-6 h-10 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
