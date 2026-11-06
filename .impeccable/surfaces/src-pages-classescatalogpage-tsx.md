---
version: 1
slug: "src-pages-classescatalogpage-tsx"
primary_target: "src/pages/ClassesCatalogPage.tsx"
related_targets: ["src/pages/PublicClassPage.tsx"]
---

# Surface brief — Public classes catalog (/classes, /classes/:slug)

Scope: two public routes extending the existing design-system world (no new tokens or fonts). Visitor mode: Persuade.
Audience: prospective learners arriving signed out from Gumroad, LinkedIn, Discord, or search; signed-in members re-reading a class they registered for.
Job: decide whether a class is worth the money and the weekly hours, then register on Gumroad.
Action: "Register on Gumroad" on the next upcoming cohort. Proof: real cohort dates, weekly commitment, instructor-written curriculum, audiences, prerequisites, and the live Gumroad description as the overview. No price is shown. No invented ratings or counts.
Constraints: WCAG 2.2 AA, 320px up, UI → hooks → services, sanitized HTML only, token never in browser.
Chosen direction: the catalog is a schedule, not a shop. Lead with "starting soon", then the two tracks; cards lead with date and commitment. Detail page keeps decision facts in a sticky aside beside the reading.
Memorable moment: the first thing a visitor reads on any class is when it starts and how many hours a week it asks.
Resolved 2026-11-06 (owner): Gumroad description is the overview; no price shown; anonymous clicks counted without identifiers; both tracks on Gumroad; plain founding-member note; header link and landing section; teachers pick products with admin override. See docs/epics/03-public-classes-catalog.md §9.

## Direction contract

THESIS: A class catalog that reads as a schedule of commitments. It refuses the thumbnail grid with "Learn more" buttons; every card leads with a start date and hours per week.
OWN-WORLD: The existing TechFleet design system: Poppins body, Futura headings, tf-card surfaces, asymmetric-radius primary button, track-colored flat surfaces where a hero image is missing, dark and light themes already defined.
STORY: The visitor understands what they will do and with whom, believes it because the dates, hours, curriculum, and price are concrete and current, and registers on Gumroad.
FIRST VIEWPORT: Catalog: h1 "Classes" with a one-line lede at the top left; directly beneath, a "Starting soon" strip of up to four cohort chips (class title, start date, hours per week); the Basic and Advanced sections begin in the lower third. Detail: breadcrumb, h1, badges, then a two-column band: overview text left (about two thirds), registration aside right (dates, timezone, hours per week, Register on Gumroad). On mobile the aside collapses into a bottom bar with dates and the register action.
FORM: Code-led extension of an existing surface; position 1 of 1 (no concept tournament for an extension). seed: none (unavailable)
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
