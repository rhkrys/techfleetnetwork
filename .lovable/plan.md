## Plan: Remove platform/historical breakdown labels from MemberWorldMap

### Goal
Remove the "x platform and y historical" text breakdown from the Network Activity locations map, on both the subtitle and tooltip.

### Changes
1. **Subtitle under map title** (`src/components/MemberWorldMap.tsx` line ~139)
   - Remove the parenthetical `(N platform members + M historical)` from the total members subtitle.
   - Keep the total member count and countries represented text.

2. **Hover tooltip** (`src/components/MemberWorldMap.tsx` line ~192)
   - Remove the `(${plat} platform + ${ext} historical)` breakdown from the country tooltip.
   - Keep the country name and total count.

### Verification
- Preview the Network Activity page and confirm the map subtitle no longer shows platform/historical breakdown.
- Hover a country on the map and confirm the tooltip shows only total count.

No other files or logic need to change.