## Change

In `src/components/NetworkActivity.tsx` (lines 225–227), remove the `sublabel={`+${...} since platform launch`}` prop from the Beginner, Advanced, and General Applications StatCards. The "across N members" sublabel on Core Course Completions (line 224) stays — it's informative, not a delta.

No other files render "+N since…" stat sublabels (verified via repo search). `StatCard`'s `sublabel` prop stays optional, so no API change.

## Out of scope

Card layout, values, icons, colors, and the Core Courses "across N members" sublabel are untouched.