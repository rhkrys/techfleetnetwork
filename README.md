# Tech Fleet Network

> The platform where people learn to lead through service by doing real work, on real teams, for real clients.

[![CI](https://github.com/techfleetworks/techfleetnetwork/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/techfleetworks/techfleetnetwork/actions/workflows/ci.yml)
[![BDD Gate](https://github.com/techfleetworks/techfleetnetwork/actions/workflows/bdd-gate.yml/badge.svg?branch=main)](https://github.com/techfleetworks/techfleetnetwork/actions/workflows/bdd-gate.yml)
[![Accessibility](https://github.com/techfleetworks/techfleetnetwork/actions/workflows/a11y-audit.yml/badge.svg?branch=main)](https://github.com/techfleetworks/techfleetnetwork/actions/workflows/a11y-audit.yml)

Tech Fleet Network is the member platform for **Tech Fleet**, a nonprofit workforce
development organization. It is where trainees, teammates, coaches, and administrators
come together to run the programs, projects, classes, and community that help people grow
into service leaders. Read this guide top to bottom. It starts with who we are and why the
platform exists, then covers what you can do inside it, and ends with what a developer
needs to run, fork, or contribute to the code.

---

## Table of contents

- [Part 1: About Tech Fleet](#part-1-about-tech-fleet)
  - [Our mission, vision, and values](#our-mission-vision-and-values)
  - [The problem we solve](#the-problem-we-solve)
  - [Our commitment to the world](#our-commitment-to-the-world)
  - [The seven Team Practices](#the-seven-team-practices)
  - [Our programs](#our-programs)
  - [Who Tech Fleet is for](#who-tech-fleet-is-for)
- [Part 2: Using the platform](#part-2-using-the-platform)
  - [Roles on the platform](#roles-on-the-platform)
  - [Getting started as a member](#getting-started-as-a-member)
  - [Feature guide](#feature-guide)
  - [Meet Fleety, our AI guide](#meet-fleety-our-ai-guide)
  - [For coaches and administrators](#for-coaches-and-administrators)
  - [Accessibility and privacy](#accessibility-and-privacy)
- [Part 3: For developers](#part-3-for-developers)
  - [Tech stack](#tech-stack)
  - [How the app is built](#how-the-app-is-built)
  - [Running the app locally](#running-the-app-locally)
  - [Testing](#testing)
  - [Deployment](#deployment)
  - [Contributing](#contributing)
  - [Design principles that shape the code](#design-principles-that-shape-the-code)
- [License](#license)

---

# Part 1: About Tech Fleet

Tech Fleet is a nonprofit workforce development organization. We help people build the
human-centered skills the modern workplace needs, like teamwork, communication, shared
decision making, and leadership, by putting them on real teams doing real work. We believe
leadership is not a title you earn after years of waiting. It is a practice anyone can
learn, and it starts with serving the growth of the people around you.

> We always write our name as two words: **Tech Fleet**.

## Our mission, vision, and values

**Mission.** To build environments of empowered teams. We are building a world where
everyone can lead through service, teams are empowered to make decisions together, and
people grow together without judgment.

**Vision.** A world where we can work together with shared power and autonomy.

**Core values.**

- **Service.** We work together to support our collective growth, learning, and
  sustainability. We amplify voices that have been unseen and unheard at work.
- **Responsibility.** We are all responsible for the future of work. Anyone willing to
  commit and bring a learner's mind is welcome. Steward leadership is at the heart of our
  community.
- **Community.** As a distributed organization, the people we serve have the power to
  shape our future. Everyone has something to offer.
- **Continuous Improvement.** We constantly look for ways to deliver more value, and we
  treat mistakes as chances to learn rather than failures.

## The problem we solve

The world of work is leaving people behind:

- **The experience trap.** Many entry-level jobs ask for three to five years of
  experience, so newcomers cannot get the experience they are required to have.
- **Outdated leadership.** The skills companies want are shifting toward human-centered
  abilities, but most leadership training is still authoritarian and top-down.
- **Barriers to access.** People from historically excluded backgrounds face the steepest
  climb to leadership.

Tech Fleet bridges the experience gap through real teamwork and collective decision
making. We provide hands-on, practice-based learning with real teamwork, real practice,
and real clients. We remove barriers to leadership for people who have been shut out of it.
Our promise is a lifelong system for learning, practicing, and growing as a service leader
in a safe, inclusive environment.

## Our commitment to the world

The mission to build empowered team spaces will never end. Over the next ten years, Tech
Fleet is committing to **preparing the next 10,000 service leaders in the world** (2025 to
2035).

A **service leader** is someone who:

- believes in transferring ownership,
- shares leadership instead of holding onto it,
- serves other people's chances to grow and learn, and
- removes their own power and transfers it to the team.

Ten thousand is not a vanity number. It is roughly the scale at which this way of working
stops being a niche experiment and starts to shift the broader work world. Each service
leader carries these habits into their own teams, jobs, and communities. To keep the door
open to everyone, cost is never the barrier. A free **Starter membership** anchors our
accessible pathways.

## The seven Team Practices

Everything Tech Fleet teaches comes back to seven behaviors we call the **Team Practices**,
and much of this platform is built to support them. Members learn and practice them in real
team settings, and we measure growth in them over time:

1. **Service Leadership.** Leading by serving the growth of others.
2. **Psychological Safety.** Creating a space where it is safe to take risks and speak up.
3. **Collective Decision Making.** Deciding together rather than by command.
4. **Empowerment.** Giving people real authority and ownership.
5. **Shared Ownership.** Everyone holds responsibility for the outcome.
6. **Continuous Improvement.** Learning and adapting instead of fearing mistakes.
7. **Agility.** Building in small steps so the team can learn as it goes.

## Our programs

Tech Fleet develops leaders across three connected programs. The platform is the home for
all of them.

### Learning Labs Program

People learn through projects and practice with practitioners.

- Project-based education on subjects that develop empowered teams.
- Leadership case-study and portfolio training.
- Coaching, mentoring, and assessments that measure growth in the Team Practices.
- A path into the Project Training program.

### Empowered Team (Project Training) Program

Leaders learn to build empowered teams and solve problems with real clients.

- Full cross-functional teams work with nonprofit and community clients.
- Teammates share leadership and ownership and practice building an empowered team.
- Space to fail and experiment safely, guided by empowered-team coaches.
- Portfolio-building and structured reflection on how the Team Practices were applied.

### Community Collaboration Program

Members keep growing together beyond their projects.

- Peer mentoring circles and community events that celebrate service-leadership stories.
- Ongoing connection and resource sharing.
- Ambassador training so members spread the Team Practices in their own workplaces.

## Who Tech Fleet is for

We serve four main audiences who want a better way of working and leading:

1. **Recent graduates and career changers** who are stuck in the experience trap and need
   real-world practice to build skills and a portfolio.
2. **Senior contributors** who want to grow into leadership and help develop emerging talent.
3. **Middle managers** who want to strengthen how they lead diverse, distributed teams.
4. **Executives** who want to build cultures of empowered teams across their organizations.

---

# Part 2: Using the platform

This section is a practical guide to what you can do once you sign in. It follows the real
navigation of the app.

## Roles on the platform

What you see depends on your role:

- **Member or trainee.** Takes courses, applies to projects, tracks their journey, and
  joins the community.
- **Teammate.** An active member working on a project training team.
- **Coach or teacher.** Guides teams and classes and reviews member progress.
- **Administrator.** Manages the roster, applications, clients, content, and the health of
  the system.

Access to each area is enforced by row-level security in the database, so the menu adapts
to what you are allowed to do.

## Getting started as a member

1. **Create an account** at `/register`, or sign in at `/login`. Password reset lives at
   `/forgot-password`.
2. **Set up your profile** (`/profile-setup`) so teams and coaches know who you are.
3. **Follow the Welcome wizard** (`/welcome`) for a guided first-run tour.
4. **Land on your Dashboard** (`/dashboard`), your home base. It shows what to do next and
   links to everything else.

## Feature guide

| Area                           | Where to find it           | What it does                                                                                           |
| :----------------------------- | :------------------------- | :----------------------------------------------------------------------------------------------------- |
| **Dashboard**                  | `/dashboard`               | Your personal home. Shows what to do next and links into everything below.                             |
| **My Journey**                 | `/my-journey`              | Your progress through Tech Fleet as quests and milestones, tracking growth in the Team Practices.      |
| **Courses and Curriculum**     | `/courses`, `/curriculum`  | Learning Labs content: onboarding, the agile mindset, agile teamwork, project-training prep, and more. |
| **Project openings**           | `/project-openings`        | Browse open roles on real client project teams and view the details of each opening.                   |
| **Applications**               | `/applications`            | Apply to projects or submit a general application, and track the status of each one.                   |
| **Events**                     | `/events`                  | The community calendar of workshops, learning sessions, and gatherings.                                |
| **Resources**                  | `/resources`               | The library of guides, templates, and reference material from our Skills and Practices Framework.      |
| **Community and Get Help**     | `/community/get-help`      | Support and community tickets. Ask for help and track the response.                                    |
| **Fleety (AI chat)**           | `/chat`                    | An AI guide based on Tech Fleet's own knowledge base (see below).                                      |
| **Updates**                    | `/updates`                 | Announcements and what is new on the platform.                                                         |
| **Notifications and settings** | `/settings/notifications`  | Control what you are notified about and how.                                                           |
| **Feedback**                   | `/feedback`                | Tell us what is working and what is not.                                                               |
| **Connect Discord**            | `/courses/connect-discord` | Link your Discord account for community and course features.                                           |

Dates and times across the app follow a distributed-community convention. We write them as
Month Day, Year with a 12-hour clock and a time zone (for example, March 4, 2026 at 1:00 pm
EST), because our members are everywhere.

## Meet Fleety, our AI guide

**Fleety** is Tech Fleet's built-in assistant. You can reach it at `/chat` and through the
`/fleety` command in the community Discord. Fleety answers questions using Tech Fleet's own
knowledge base, which includes the public Skills and Practices Framework and platform
documentation, and it cites its sources instead of making things up. Use it to understand
the Team Practices, find your way around a program, or get unstuck.

## For coaches and administrators

Administrators and coaches have a dedicated set of tools. They live under `/admin` and
`/teach`, and each one is gated by role:

- **Roster** (`/admin/roster`): manage cohorts, teams, and members across projects.
- **Applications** (`/admin/applications/...`): review and analyze applications to projects.
- **Clients and projects** (`/admin/clients`): manage client organizations and the project
  openings that trainees apply to.
- **Classes and teaching** (`/teach/classes`): author and run curriculum for classes.
- **Content**: updates, banners (`/admin/banners`), and brand tokens (`/admin/brand-tokens`).
- **Accounts and policies** (`/admin/users`, `/admin/policies`): account administration and
  platform policies.
- **Ingest** (`/admin/ingest`): bring hand-off material and reference content into the
  knowledge base.
- **Activity log and System Health** (`/admin/activity-log`, `/admin/system-health`): see
  what is happening and whether background systems are healthy.

## Accessibility and privacy

Accessibility is a civil right at Tech Fleet, not an afterthought. The platform targets
**WCAG 2.2 AA** as a baseline: high color contrast, full keyboard navigation, descriptive
alt text, captions and transcripts for media, layouts that reflow on small screens and at
high zoom, and respect for the `prefers-reduced-motion` setting. Dedicated pages cover our
commitments and your rights:

- Accessibility statement: `/accessibility`
- Privacy policy: `/privacy`
- Cookies: `/cookies`
- Terms of use: `/terms`, `/terms-of-use`
- Code of conduct: `/code-of-conduct`
- **Data requests (DSAR):** `/privacy/dsar`, to ask what data we hold about you or to
  request its deletion.

---

# Part 3: For developers

This is a Lovable-built app that Tech Fleet now manages itself. It serves a real,
production community of roughly 767 members, so treat every change as production.

## Tech stack

**Frontend**

- [Vite](https://vitejs.dev/) 7 and [TypeScript](https://www.typescriptlang.org/)
- [React](https://react.dev/) 18 with [React Router](https://reactrouter.com/) 7
- [shadcn/ui](https://ui.shadcn.com/) (Radix UI primitives) and [Tailwind CSS](https://tailwindcss.com/)
- [TanStack Query](https://tanstack.com/query) for server state and caching
- [i18next](https://www.i18next.com/) for internationalization, [XState](https://xstate.js.org/)
  for complex flows, and [Recharts](https://recharts.org/) and AG Grid for data views
- [Zod](https://zod.dev/) for validation

**Backend.** [Supabase](https://supabase.com/): Postgres and PostgREST, GoTrue auth,
row-level security (RLS), and Deno **edge functions** (in `supabase/functions/`).

**Hosting.** The static frontend is served behind Nginx and Cloudflare. There is no
production Node server.

## How the app is built

Layer boundaries matter. When you fix something, name the layer first (UI, state, data,
auth, API, database, or infrastructure) and fix it at that layer.

- **Use only one Supabase client.** There is exactly one Supabase client instance
  (`src/integrations/supabase/client.ts`). Never create a second one.
- **Data flows through React Query,** not one-off fetches, so caching and dedupe stay
  consistent.
- **Auth is a frozen layer.** Sign-in, sign-up, reset, and MFA, the boot block in
  `main.tsx`, and everything under `src/lib/auth/**` and `src/features/auth/**` are
  change-controlled and require the full auth regression suite to pass. See
  [`.claude/skills/06-auth-flow-lockdown.skill.md`](.claude/skills/06-auth-flow-lockdown.skill.md).
- **Fix config problems in config.** Apex and www redirects, OAuth origins, caching, and
  domains are infrastructure concerns. Solve them in Nginx, DNS, the CDN, or CI, not with
  client-side guards.

## Running the app locally

**Prerequisites:** Node.js (LTS) and npm. This repo uses **npm** as its package manager. Do
not install with Deno or Bun, which have caused broken installs and silent deploy failures.

```bash
# 1. Install dependencies (clean, reproducible install)
npm ci

# 2. Start the dev server
npm run dev
```

The dev server prints a local URL. Supabase credentials are read from environment
variables. Ask a maintainer for the values you need to point at a working backend.

## Testing

CI is the source of truth. Do not trust an in-tool test runner.

```bash
npm run test          # Vitest unit and component suite
npm run test:e2e      # Playwright end-to-end suite
npm run lint          # ESLint
npm run format:check  # Prettier
```

Every feature ships with behavior-driven (Gherkin and BDD) scenarios wired into CI through
the **BDD gate**, plus unit, end-to-end, accessibility (axe), visual-regression,
bundle-size, and security checks. The workflows live in
[`.github/workflows/`](.github/workflows/).

## Deployment

- **Frontend.** Push to `main` and **Cloudflare Pages** deploys automatically through its
  Git integration. There is no separate GitHub Actions deploy step for the frontend. The
  build runs `npm run build` and produces a static `dist/`.
- **Edge functions.** These deploy through
  [`.github/workflows/deploy-edge-functions.yml`](.github/workflows/deploy-edge-functions.yml)
  when files under `supabase/functions/` change.

> If a merged change is not live, the usual cause is a Cloudflare build that failed quietly
> (most often an `npm ci` dependency conflict), not the code itself.

## Contributing

Read [`CLAUDE.md`](CLAUDE.md) first. It holds the project's prime directives. In short:

1. Never claim a change you did not make. Every stated edit has a real diff.
2. Fix root causes at the responsible layer, not symptoms in the UI.
3. Prove every fix with a test that failed before and passes after.
4. Make the smallest change that fully solves the problem. No drive-by rewrites.
5. Never weaken auth, RLS, validation, or types to make something pass.
6. Label guesses as hypotheses. Ask for missing context instead of inventing it.

Area-specific rules live in [`.claude/skills/`](.claude/skills/):

| Skill                    | Covers                                                  |
| :----------------------- | :------------------------------------------------------ |
| `01-architecture`        | Layering, the one-client rule, React Query data flow    |
| `02-secure-coding-owasp` | OWASP for React, Supabase, and edge functions           |
| `03-database-rls`        | Migrations, RLS, indexing, RPC security                 |
| `04-performance-scale`   | Caching, dedupe, pagination, cost at scale              |
| `05-devops-cicd`         | CI gates, migrations in CI, environments, observability |
| `06-auth-flow-lockdown`  | The frozen auth layer (overrides others on conflict)    |

**Definition of done:** you named the root cause and the layer; a repro failed before and
passes after, with a test added; tests, typecheck, and lint are green with no new warnings;
only necessary files changed; and security is not weakened.

## Design principles that shape the code

Tech Fleet's brand has six design principles, and they are engineering constraints as much
as visual ones:

- **Minimalist.** Reduce cognitive load. Remove what does not serve a clear purpose.
- **Universal.** Accessible by default (WCAG 2.2 AA), never retrofitted.
- **Intuitive.** Respect established patterns so people do not have to think.
- **Purposeful.** Every element solves a real need for the people using it.
- **Intentional.** Consistent spacing, type, and color. Nothing is accidental.
- **Welcoming.** Warm, plain-language copy and forgiving, helpful error states.

Interface copy follows a plain-language standard (a 7th to 9th grade reading level),
action-oriented button labels ("Verb + Noun"), and empathetic, actionable error messages.

---

## License

Copyright Tech Fleet Professional Association, Inc. All rights reserved. See the repository
settings or contact a maintainer for licensing and contribution terms.
