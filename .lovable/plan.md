## Problem
GitHub deprecated `actions/cache@v1/v2`. The workflow files reference `actions/cache@0c45773b623bea8c8e75f6c82b208c3cf94ea4f9` — this is the v2.0.10 commit SHA, not v4.1.2 as the comment claims. GitHub Actions now auto-fails workflows using this version.

## Affected files/lines
- `.github/workflows/regression.yml`
  - Line 62-63: node_modules cache step (comment + SHA)
  - Line 231: Playwright browser cache step
- `.github/workflows/cross-browser.yml`
  - Line 53: node_modules cache step
  - Line 120: node_modules cache step

## Fix
Replace the v2 SHA `0c45773b623bea8c8e75f6c82b208c3cf94ea4f9` with the v4.1.2 SHA `6849a648993a5b7d0f9cdf3bfe5757fe5f7b1e06` in all four places, and update the comment on line 62 to correctly say v4.1.2.

## Verification
No code changes — workflow fix only. Next CI run will validate.