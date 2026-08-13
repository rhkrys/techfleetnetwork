# Deliverable Research Briefs

Authoritative, sourced grounding for each deliverable produced by Tech Fleet workshops. Purpose: an
external-knowledge lens for interpreting the FigJam workshop boards **precisely**. Rule of the road:
**external research is context; Tech Fleet's own method (its workshops + Deliverables-table narratives)
is the source of truth.** Where the industry-standard version diverges from Tech Fleet's approach, it
is flagged as `DIVERGENCE` for founder ruling, never silently applied.

Each brief: Definition · Structure/Parts · How it's made · Source(s) · Notes/Divergences.

---

## Empathy Map

- **Definition:** A collaborative visualization of what the team knows about a type of user, to build shared understanding of user needs.
- **Structure:** Classic 4 quadrants around a user: **Says, Thinks, Does, Feels** (some variants add Pains/Gains). Originated by Dave Gray (XPLANE), refined by NN/g.
- **How it's made:** Team reads research individually, writes sticky notes per quadrant, places them on the map, then discusses agreement and gaps.
- **Sources:** NN/g "Empathy Mapping: The First Step in Design Thinking" (nngroup.com/articles/empathy-mapping/).
- **Notes:** Tech Fleet's board uses `I THINK / I ACT / I FEEL / I SAY / I VALUE / I'M MOTIVATED BY` (first-person, 6 prompts) — a richer variant. Honor Tech Fleet's 6 prompts, not the classic 4.

## RACI Charts

- **Definition:** A responsibility-assignment matrix clarifying, per task, who is **Responsible, Accountable, Consulted, Informed**.
- **Structure:** Rows = tasks/deliverables; columns = people/roles; each cell = R/A/C/I.
- **How it's made:** List every task, then assign exactly **one Accountable** and at least one Responsible per task; add Consulted/Informed.
- **Sources:** Atlassian RACI guide (atlassian.com/work-management/project-management/raci-chart).
- **Notes:** Key rule to preserve — exactly one Accountable per task. Tech Fleet uses "RACI Hats," framing roles as hats a teammate wears.

## User Journey Map

- **Definition:** A visualization of the process a person goes through to accomplish a goal (NN/g).
- **Structure:** Persona + Scenario/Goal + Journey Stages + Actions + Thoughts/Emotions + Opportunities (and pain points, channels).
- **How it's made:** Compile user actions into a timeline, add thoughts/emotions to form a narrative, condense to a shareable visualization; cross-functional effort.
- **Sources:** NN/g "Journey Mapping 101" and "How Practitioners Create Journey Maps."
- **Notes:** Distinct from CX diagram/service blueprint (see below).

## Customer Experience Diagram (CX Map)

- **Definition:** A visualization of an end-to-end experience a (often generic) person has across touchpoints to reach a goal; broader/more zoomed-out than a single journey map.
- **Structure:** Touchpoints across the whole relationship; may span channels and time; focuses on the human experience, not internal ops.
- **How it's made:** Map the full set of touchpoints and the experience at each.
- **Sources:** NN/g "UX Mapping Methods Compared: A Cheat Sheet."
- **DIVERGENCE to watch:** industry separates _journey map_ (one goal), _experience map_ (whole relationship), and _service blueprint_ (adds internal/backstage). Confirm which Tech Fleet's "Customer Experience Diagram" means before synthesizing; the board's content decides.

## User Personas / Proto Personas / Buyer Personas

- **Definition:** Semi-fictional characters representing a segment of users. **User persona** = who uses the product; **Buyer persona** = who decides to purchase; **Proto persona** = a best-guess persona made without new research.
- **Structure:** Goals, needs, behaviors, background, pains; buyer personas add buying drivers.
- **How it's made:** Research-based (find commonalities across participants) or proto (team workshop from existing knowledge/assumptions).
- **Sources:** userinterviews.com UX Research Field Guide; NEWMEDIA personas-vs-proto-personas; uxpressia user-vs-buyer.
- **Notes:** All buyer personas are user personas, but not vice-versa. Tech Fleet's Audience Persona workshop appears to build proto/user personas in-session.

## Sprint Goals

- **Definition:** The single objective for a Sprint; a commitment that provides focus and a target to measure progress against.
- **Structure:** One outcome-focused statement. Scrum.org template: "Our focus is on <Outcome>. We believe it delivers <Impact> to <Customer>. Confirmed when <Event>."
- **How it's made:** Set by the whole Scrum Team during Sprint Planning; must be attainable; kept visible; checked in the Daily Scrum.
- **Sources:** Scrum.org "The Sprint Goal" and "What is a Sprint Goal?"
- **Notes:** Authoritative (Scrum Guide). Safe to lean on directly.

## Working Agreements

- **Definition:** Team-authored guidelines/behaviors for how the team will work together; a social contract that evolves as the team matures.
- **Structure:** Norms across communication, meetings, feedback, conflict, definition of done, absence, change requests.
- **How it's made:** Diverge (individual ideas) then converge (group agreement); revisit after retros.
- **Sources:** Scrum.org "Creating a Team Working Agreement"; Swarmia guide.
- **Notes:** Tech Fleet's board frames it around agile tenets: how the team will build psychological safety, service leadership, self-organization, continuous improvement, and handle conflict/pivots/communication. Honor that framing.

## Problem Statements

- **Definition:** A clear, concise description of a user's problem/pain point (a.k.a. point-of-view or user-need statement); defines the gap between current and desired state.
- **Structure:** User-focused, 1–3 sentences: who, what need, why it matters. Does NOT propose a solution.
- **How it's made:** Identify a user + need + insight; broad enough for creativity, narrow enough for direction.
- **Sources:** NN/g "Problem Statements in UX Discovery"; IxDF "What is a UX Problem Statement?"
- **Notes:** Tech Fleet's Scenario-Based board generates these and translates to How Might We statements (see Rapid Ideation).

## Problem Checklists

- **Definition:** A running list of the specific problems/needs identified, tracked as concrete items (a Tech Fleet framing that pairs with problem statements).
- **Structure:** Enumerated problems, often prioritized.
- **How it's made:** Capture problems surfaced in discovery/requirements; keep updated.
- **Sources:** Extends the problem-statement literature (NN/g, IxDF).
- **Notes:** Largely a Tech Fleet organizational artifact; lean on the board + Deliverables narrative.

## Acceptance Criteria

- **Definition:** Predefined conditions a story/feature must meet to be considered done and working as expected.
- **Structure:** Often the **Given / When / Then** format (from BDD): Given a precondition, When an action, Then an expected outcome. Also written as simple checklists.
- **How it's made:** Written per user story before/during refinement; must be testable and unambiguous.
- **Sources:** ScrumAlliance "Acceptance Criteria"; c-sharpcorner Given-When-Then guide.
- **Notes:** Tech Fleet's Business Analysis produces these; they feed QA test cases and acceptance testing.

## User Story Statements

- **Definition:** A short feature description from the end user's perspective.
- **Structure:** "As a [user], I want [goal] so that [reason]." Should meet **INVEST** (Independent, Negotiable, Valuable, Estimable, Small, Testable).
- **How it's made:** Identify the user + goal + benefit; pair with acceptance criteria; keep small enough for one sprint.
- **Sources:** Atlassian "User Stories"; scrum-master.org INVEST guide.
- **Notes:** Core agile unit; safe to lean on directly.

## Epics and Features

- **Definition:** Mid-level work items. **Epic** = a large strategic body of work spanning sprints/releases; **Feature** = a user-facing capability inside an epic.
- **Structure:** Hierarchy Theme → Epic → Feature → User Story → Task. Epics define strategy; features deliver it incrementally.
- **How it's made:** Break big goals (epics) into features, then into stories.
- **Sources:** monday.com "Agile epic vs feature"; visual-paradigm hierarchy guide.
- **Notes:** Tech Fleet's Product Management/Ownership produce these during Requirements/Scope.

## How Might We (HMW) Statements

- **Definition:** A design-thinking reframe of a research insight into an open, solvable question that invites ideas without prescribing a solution.
- **Structure:** "How might we [help user] [achieve need]?" Broad enough for creativity, narrow enough for focus.
- **How it's made:** Ground in a real insight/problem statement; write several from different angles; use to launch ideation.
- **Sources:** NN/g "Using How Might We Questions"; IxDF "What is How Might We". (Originated at P&G, popularized by IDEO.)
- **Notes:** Directly used in Tech Fleet's Rapid Ideation board (problem statements → HMW → ideate).

## Affinity Map

- **Definition:** Clustering related observations/ideas into themes to make sense of qualitative data (a.k.a. the KJ method, after Jiro Kawakita).
- **Structure:** Sticky notes grouped into named clusters/themes.
- **How it's made:** Generate notes → sort into natural groups → step back and name the themes/insights.
- **Sources:** NN/g "Affinity Diagramming for Sorting UX Findings and Ideas."
- **Notes:** Used in Tech Fleet's UX Research Analysis workshop.

## Competitive Analysis

- **Definition:** A systematic evaluation of competitors' user experiences/offerings to find gaps and differentiation.
- **Structure:** Compare ~3–5 direct + ~2 indirect competitors across usability, features, content, satisfaction.
- **How it's made:** Identify competitors → research consistently against set criteria → synthesize gaps/opportunities. Best done early (discovery).
- **Sources:** Maze "UX Competitive Analysis"; LogRocket guide.
- **Notes:** Feeds positioning, market research, product-market fit in Tech Fleet's Market Research workshop.

## Vision Boards

- **Definition:** Roman Pichler's Product Vision Board — a one-page tool to describe/validate a product vision and high-level strategy.
- **Structure:** Five sections: **Vision, Target Group, Needs, Product (key features), Business Goals.**
- **How it's made:** Fill top-down (Vision first), collaboratively; review ~quarterly; validate the assumptions in each section.
- **Sources:** Roman Pichler "The Official Product Vision Board" (romanpichler.com).
- **Notes:** Tech Fleet's Vision & Scope workshop produces vision boards; honor the 5-section structure if the board uses it.

## Roadmap

- **Definition:** A living, outcome-focused plan for how a product evolves over time; in agile, responsive to change rather than a fixed plan.
- **Structure:** Themes/goals over a timeline; can span multiple teams.
- **How it's made:** Start from strategy/vision + market/customer input; review quarterly; keep shared and linked to delivery.
- **Sources:** Atlassian "Agile roadmaps"; Agile Alliance roadmaps guide.
- **Notes:** Ties to Vision milestone; keep the "living, adjusts as we learn" agile framing.

## Statement of Work (SOW)

- **Definition:** A foundational (often contractual) document defining a project's scope, objectives, deliverables, and terms.
- **Structure:** Background, objectives, scope, deliverables, acceptance criteria, timeline, resources, assumptions/constraints.
- **How it's made:** Agreed at project start between team and client; sets shared expectations.
- **Sources:** Atlassian "What is a Statement of Work"; projectmanager.com SOW guide.
- **Notes:** Tech Fleet's Client Kickoff produces this at Intake.

## Gantt Chart

- **Definition:** A schedule chart showing tasks, their order, durations, dependencies, and milestones over a timeline.
- **Structure:** Task list (left) + horizontal timeline bars (right); shows dependencies, assignees, critical path.
- **How it's made:** List tasks, set durations/dependencies, place on a timeline; track progress vs plan.
- **Sources:** projectmanager.com Gantt guide; APM.
- **Notes:** DIVERGENCE to watch — Gantt is a more waterfall-flavored tool; Tech Fleet uses it in the Project Plan workshop, so frame it in their agile context (a living guide, not a fixed contract).

## Market Research Analysis

- **Definition:** The systematic collection and interpretation of data about a market, customers, competitors, and industry to guide decisions.
- **Structure:** Market size, competitors, pricing, customer needs; mixes quantitative (size, price) and qualitative (motives, values) data.
- **How it's made:** Define purpose → analyze industry/target market/competition → collect via surveys/interviews/secondary sources → synthesize.
- **Sources:** AMA "How to Conduct a Market Analysis"; ideascale.
- **Notes:** Feeds the business plan, positioning, and go-to-market in Tech Fleet's Market Research workshop.

## Positioning Statement

- **Definition:** A short, internal statement of how a brand/product meets a need better than competitors.
- **Structure:** Template — "For [target market], [brand] is the [point of differentiation] among all [frame of reference] because [reason to believe]." Covers target audience, category, key benefit, differentiation.
- **How it's made:** Define audience, category, unique benefit, and proof; keep simple, memorable, credible.
- **Sources:** HubSpot "Positioning Statements"; Cornell eCornell guide.
- **Notes:** Internal compass for messaging; feeds the UVP and marketing.

## Unique Value Proposition

- **Definition:** A single clear statement of the main benefit a product delivers that beats alternatives; who it helps, what problem it solves, why it's different.
- **Structure:** 1–5 sentences: target, core problem, solution/benefit, differentiation.
- **How it's made:** Identify audience → define core problem → describe solution → research customers → write (focus on the solution).
- **Sources:** CXL "Value Proposition Examples"; Semrush.
- **Notes:** Sharper/customer-facing sibling of the positioning statement.

## Product-Market Fit Analysis

- **Definition:** Marc Andreessen — "being in a good market with a product that can satisfy that market." Whether the product truly resonates with a real market.
- **Structure:** Primarily qualitative signals (word of mouth, usage growth, demand outpacing supply); a common quantitative proxy is Sean Ellis's 40%-"very disappointed" rule.
- **How it's made:** Assess demand signals, retention, and the 40% survey; iterate product/market until fit.
- **Sources:** a16z "12 Things About Product-Market Fit"; Andreessen's "The Only Thing That Matters."
- **Notes:** Judgment-heavy; frame as signals, not a single number.

## Customer Segmentation

- **Definition:** Grouping customers by shared traits/behaviors/needs to serve them more relevantly.
- **Structure:** Four common types — **demographic, geographic, behavioral, psychographic.**
- **How it's made:** Combine types for a fuller view; start with one segment and expand.
- **Sources:** Qualtrics "Customer Segmentation"; Coursera.
- **Notes:** Feeds personas, positioning, and targeting in Tech Fleet's Audience Segmentation workshop.

## Key Performance Indicators (KPIs)

- **Definition:** Quantifiable measures of performance over time against a specific objective.
- **Structure:** A good KPI is specific, has a formula + target, a review cadence, and one named owner; keep to ~5–7.
- **How it's made:** Start from clear objectives → align to strategic goals → consider the report's users → pick the vital few.
- **Sources:** Asana "What Are KPIs"; KPI.org.
- **Notes:** Tech Fleet's KPI Success Measurements workshop defines these at Intake alongside goals/OKRs.

## Research Plan

- **Definition:** A brief reference document outlining a study's goals, questions, methods, participants, and logistics.
- **Structure:** Background/context, research goals, key research questions, methods, participants + recruiting, timeline, (for moderated methods) a discussion guide/script.
- **How it's made:** Define persona + goals → key questions → methods/tools → participants → timeline. Plan before running research.
- **Sources:** NN/g "Research Plans: Organize, Document, Inform"; Maze.
- **Notes:** Tech Fleet's Research Plan workshop frames UX as scientific (hypotheses → tests) and maps topics → assumptions → questions → measurements.

## Research Report

- **Definition:** A document summarizing research findings in language stakeholders understand, enabling informed decisions.
- **Structure:** Findings + what they mean + actionable recommendations; state who the data represents and its limitations.
- **How it's made:** Present truthfully and responsibly; build empathy for users; translate findings into clear next steps.
- **Sources:** NN/g "How to Present UX Research Results"; Survicate.
- **Notes:** An objective source of truth that aligns the team on priorities.

## Usability Test Report

- **Definition:** A document summarizing findings and recommendations from a usability test.
- **Structure:** Usability issues categorized by severity, the related task/data, user feedback, visual evidence (clips/screenshots), prioritized actionable recommendations.
- **How it's made:** Distill observation into clear findings + action items; prioritize by severity/impact/feasibility.
- **Sources:** UXQB CPUX-UT report example; Xtensio guide.
- **Notes:** A focused subtype of the research report, specific to usability testing.

## Sitemap

- **Definition:** A visual outline (tree/flowchart) of a product's pages/screens and how they connect; a view of structure and navigation.
- **Structure:** Primary + secondary pages, hierarchy, main navigation paths.
- **How it's made:** Catalog content → group/label per information architecture → arrange hierarchy. Comes after IA is set, before user flows/wireframes.
- **Sources:** LogRocket "How to Create a UX Sitemap"; Yale Usability.
- **Notes:** Distinct from information architecture (IA = the organizing logic; sitemap = the resulting page map).

## Storyboard

- **Definition:** A visual, comic-strip-style depiction of a user's experience with a product over time in a specific scenario.
- **Structure:** Four elements — Character (the user), Scene (environment), Plot (the solution/benefit), Narrative (the problem and how the design solves it); a sequence of frames.
- **How it's made:** Define goal → research users → develop persona + scenario → sketch the frames (low-fi is fine).
- **Sources:** IxDF "UX Storyboards: Ultimate Guide"; Figma resource library.
- **Notes:** Tech Fleet's Storyboarding workshop; builds on personas/journey maps.

## Sketches

- **Definition:** Quick, rough, hand-drawn ideas to explore many directions fast; thinking on paper.
- **Structure:** Often via **Crazy 8's** — 8 ideas in 8 minutes, one per box, quantity over quality.
- **How it's made:** Time-box tightly; no critique or polish; keep ideas flowing, then converge.
- **Sources:** Google Design Sprint Kit "Crazy 8's"; Codecademy.
- **Notes:** Directly used in Tech Fleet's Rapid Ideation (Crazy 8's step).

## UX Audit Report

- **Definition:** An expert review of a product against usability principles (a heuristic evaluation) to find issues before user testing.
- **Structure:** Issues mapped to heuristics (commonly **Nielsen's 10**), with severity and recommendations. No end-users involved.
- **How it's made:** 3–5 evaluators independently walk the interface against the heuristics (a single evaluator finds ~35% of issues; 3–5 find ~75%).
- **Sources:** NN/g "10 Usability Heuristics"; IxDF "Heuristic Evaluation."
- **Notes:** Tech Fleet's UX Research Analysis produces this from heuristics analysis + analytics.

## Accessibility Analysis

- **Definition:** A formal evaluation of a product's conformance with accessibility standards, typically **WCAG**.
- **Structure:** Issues mapped to WCAG success criteria + conformance level (A / AA / AAA; most aim for AA), with locations and fixes.
- **How it's made:** Define standard/scope → combine automated testing + manual expert review + assistive-tech (keyboard, screen reader) testing → report.
- **Sources:** W3C WAI; accessible.org "How to Conduct an Accessibility Audit."
- **Notes:** Automation alone is insufficient; manual + assistive-tech testing is required.

## Sprint Plan

- **Definition:** The output of Sprint Planning: the Sprint Backlog = Sprint Goal (why) + selected Product Backlog items (what) + an actionable plan (how).
- **Structure:** Sprint Goal, selected items, and the plan to deliver an Increment; a real-time picture updated through the Sprint.
- **How it's made:** Whole Scrum Team collaborates in Sprint Planning; enough detail to inspect progress at the Daily Scrum.
- **Sources:** Scrum.org "Introduction to Sprint Planning" / "Sprint Backlog"; Scrum Guide.
- **Notes:** Authoritative (Scrum Guide). Distinct from Sprint Goals (the single objective within it).

## Release Plan

- **Definition:** An agile plan mapping a series of incremental releases (not a single big-bang launch); a dynamic document of how/when features ship.
- **Structure:** Release scope, target dates, resources; framed around customer/business outcomes; spans ~2–6 months / 3–10+ sprints.
- **How it's made:** Set iteration length + velocity → prioritize stories → frame release goals by outcome → allocate to iterations → agree DoD → keep adaptive.
- **Sources:** Easy Agile "Agile Release Plan"; Wrike.
- **Notes:** Ties to roadmap + release-level scope in Tech Fleet's Vision & Scope workshop.

## Kanban Board Statuses

- **Definition:** The columns work moves through on a Kanban board (e.g., To Do / Doing / Done), the visible states of a team's workflow.
- **Structure:** Value-stream columns, often with **WIP limits** (a common rule: team size + 1) to cap in-progress work.
- **How it's made:** Map the value-stream states → set columns → apply WIP limits to expose bottlenecks and force finishing before starting.
- **Sources:** Atlassian "WIP limits for Kanban"; Businessmap.
- **Notes:** Tech Fleet's Team Process/Team Process Mapping defines these; WIP limits are the key nuance to teach.

## Sprint Retro Action Items

- **Definition:** The concrete, committed improvements a team agrees to after a sprint retrospective.
- **Structure:** Specific, measurable tasks with owners; drawn from a retro format (Start/Stop/Continue, Mad/Sad/Glad, Sailboat, or the board's 4 Ls — liked/learned/lacked/longed-for).
- **How it's made:** Reflect on the sprint → identify improvements → agree a few action items as commitments (not just notes) with owners.
- **Sources:** Atlassian "Retrospective" play; teamretro guide.
- **Notes:** Tech Fleet's Sprint Retro board uses the 4 Ls in Part 1 and assigns owners in Part 2; the "measure agility" step (Part 3) links to Agile Maturity Measurements.

## Analytics Audit

- **Definition:** A comprehensive review of a product's analytics setup and data quality: tracking implementation, tool configuration, and data accuracy.
- **Structure:** Checks on what's collected, tracking accuracy, and privacy/compliance, with fix recommendations.
- **How it's made:** Define essential data → verify tracking mechanisms → check compliance → recommend fixes. Run at launches/redesigns.
- **Sources:** Contentsquare "Web Analytics Audit"; Growth Hackers.
- **Notes:** Feeds trustworthy KPIs/measurement in Tech Fleet's research work.

## Research Analysis

- **Definition:** Making sense of qualitative research data to find meaning; commonly via **thematic analysis**.
- **Structure:** Braun & Clarke's 6 phases — familiarize → generate initial codes → search for themes → review themes → define/name themes → report.
- **How it's made:** Code stretches of data with descriptive labels, group into themes, calibrate between analysts, pull all passages per code, write analytic memos.
- **Sources:** Qualtrics "Thematic Analysis"; Braun & Clarke framework.
- **Notes:** Underpins Tech Fleet's UX Research Analysis workshop (affinity mapping is the visual form of this).

## Prioritized Backlog Tasks

- **Definition:** Backlog items ordered so the most valuable work sits on top.
- **Structure:** Ranked list; common technique **MoSCoW** (Must / Should / Could / Won't have), from Dai Clegg / DSDM.
- **How it's made:** Weigh value vs effort; agree order with stakeholders; re-order continuously.
- **Sources:** ProductPlan "MoSCoW Prioritization"; Tempo.
- **Notes:** Feeds sprint planning; pairs with the refined backlog.

## Refined Backlog

- **Definition:** A backlog kept clear, detailed, estimated, and well-ordered through ongoing **backlog refinement** (formerly "grooming").
- **Structure:** Items broken into small, ready pieces; top items "ready for delivery."
- **How it's made:** Recurring activity — add, detail, estimate, re-order, split/merge items so the next few sprints are ready. PO + Scrum Master + team.
- **Sources:** Agile Alliance "Backlog Refinement"; Atlassian.
- **Notes:** "Grooming" was dropped by the Scrum Guide in 2013; use "refinement." Tech Fleet's Backlog Management / Discovery Backlog workshops.

## Sprint Demo Presentation

- **Definition:** How a team presents completed work at the **Sprint Review** — a working meeting to gather stakeholder feedback, not just a demo.
- **Structure:** What's Done / not Done, what went well and problems solved, a demonstration of the Increment, and discussion of what to do next.
- **How it's made:** Whole Scrum Team + stakeholders; timeboxed (~≤4 hrs for a one-month sprint); collaborate on adapting future plans.
- **Sources:** Scrum.org "Introduction to the Sprint Review" and "Myth 15: The Sprint Review Is a Demo."
- **Notes:** DIVERGENCE to teach — the review is _more_ than a demo; frame Tech Fleet's Sprint Demo as feedback + next-steps, not just a show-and-tell.

## Agile Maturity Measurements

- **Definition:** A diagnostic of how well a team has adopted agile practices, with a path to improve.
- **Structure:** Balances quantitative (velocity, cycle time) and qualitative (interviews, retros) signals across dimensions (technical excellence, culture, product vision, delivery flow); tiered scale (e.g., Initial → Emerging → Defined → Managed → Optimizing). Models: Agile Fluency, Scrum Maturity.
- **How it's made:** Assess across dimensions; treat maturity as a continuum, not a binary.
- **Sources:** Smartsheet "Agile Maturity"; TeamRetro.
- **Notes:** Tech Fleet's Agile Team Maturity workshop + the Part 3 of Sprint Retro; keep the "continuum, not pass/fail" framing.

## Project Goals Definition

- **Definition:** A clear statement of what a project aims to achieve; the shared answer to "what does success look like?"
- **Structure:** Often expressed via **OKRs** — an aspirational Objective + 3–5 measurable Key Results ("We will [objective] as measured by [key results]").
- **How it's made:** Start from the objective, write outcome-based (not task-based) key results; agree with the team/client at Intake.
- **Sources:** Asana "What are OKRs"; What Matters (Doerr).
- **Notes:** Set alongside KPIs in Tech Fleet's Intake/Project Plan; key results are outcomes, not activities.

## Project Plan

- **Definition:** The overall game plan for how a project runs: phases, milestones, timeline, roles, risks.
- **Structure:** Composite of grounded parts — Statement of Work (scope/terms), Gantt/timeline, roadmap, goals/KPIs, risk analysis.
- **How it's made:** Assembled at Intake from those inputs; kept adaptive in agile (a living guide, not a fixed contract).
- **Sources:** see SOW, Gantt, Roadmap, KPIs, OKRs briefs above.
- **Notes:** Tech Fleet's Project Plan workshop; frame agile (adjusts as the team learns).

## Release-level Scope

- **Definition:** The decision of what is in vs out for a given release.
- **Structure:** In/out boundary around epics/features; often set with MoSCoW.
- **How it's made:** Choose the minimum set that hits the release's outcome; re-scope as priorities shift.
- **Sources:** see Release Plan + MoSCoW briefs.
- **Notes:** Higher-level sibling of task-level scope; ties to roadmap + release plan in Vision & Scope.

## Psychological Safety Plan

- **Definition:** A deliberate approach to building an environment where people feel safe to speak up, ask questions, admit mistakes, and challenge ideas.
- **Structure:** Practices that build the 4 stages (Clark: inclusion → learner → contributor → challenger safety); tied to rewarded vulnerability.
- **How it's made:** Agree team behaviors that create safety (often within working agreements); revisit as the team matures.
- **Sources:** Amy Edmondson (amycedmondson.com); Timothy Clark / LeaderFactor.
- **Notes:** Tech Fleet's Working Agreements workshop produces this; research (Edmondson, Google Project Aristotle) ties it to team performance.

## Team Process Map

- **Definition:** A visualization of how work flows through a team, step by step (from intake through delivery).
- **Structure:** Stages/phases (e.g., Intake → Requirements → Planning → Sprint → Demo) with decision branches; feeds Kanban board statuses.
- **How it's made:** Study an example flow, then map the team's own process; define the resulting board statuses + WIP.
- **Sources:** see Kanban Board Statuses brief; Tech Fleet board (node 27:18733).
- **Notes:** Tech Fleet's Team Process Mapping workshop is an example-then-build-your-own; prerequisite reading = "Agile Methods in Detail."

## Strategy Definition

- **Definition:** Deciding how a product/team will reach its goals; the approach chosen before execution.
- **Structure:** Goal + the chosen path/approach + rationale; connects vision to scope/roadmap.
- **How it's made:** Clarify the goal, weigh a few realistic paths, pick one, write it down for the team.
- **Sources:** grounded in the Vision Board (Pichler) + Roadmap briefs.
- **Notes:** Tech Fleet's Customer Experience Strategy / Rapid Ideation produce strategy; largely their own framing.

## Stakeholder Feedback

- **Definition:** Input gathered from people invested in the product (clients, users, leaders) to steer the work.
- **Structure:** Captured feedback tied to what it concerns; often collected during reviews/testing.
- **How it's made:** Gather via reviews, user acceptance testing, demos; record and route into priorities.
- **Sources:** grounded in Sprint Review + Usability Test Report briefs.
- **Notes:** Produced across Discovery/Implement/Launch/Acceptance Testing; feeds the backlog.

## Rainbow Table

- **Definition:** A color-coded grid tracking which research participants said/did what, so patterns across people are visible. (Tech Fleet / UX-research usage — not the security "rainbow table.")
- **Structure:** Rows = findings/behaviors, columns = participants, colored cells = who exhibited each.
- **How it's made:** Log each participant's data in the grid; scan for common vs one-off findings; feeds affinity mapping + research analysis.
- **Sources:** grounded in the Research Analysis / thematic analysis brief; Tech Fleet term.
- **Notes:** DISAMBIGUATION — do not confuse with the cryptographic "rainbow table." This is a research-synthesis grid.

## Personal Growth Roadmap

- **Definition:** A plan for how an individual will build their skills over time; a development map for one person.
- **Structure:** Vision (who you want to become) + scope (focus areas) + a roadmap of steps/milestones.
- **How it's made:** Reflect on goals, choose focus skills, sequence steps; supported by coaching.
- **Sources:** grounded in the Roadmap brief; Tech Fleet's Personal Growth Vision/Scope/Roadmap workshop.
- **Notes:** Largely a Tech Fleet development artifact; mirrors the product Vision/Scope/Roadmap pattern applied to a person.
