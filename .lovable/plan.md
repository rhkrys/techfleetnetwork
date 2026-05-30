Update deprecated `actions/cache` from v2 commit SHA (`6849a64899...`) to v4 commit SHA (`0c45773b623bea8c8e75f6c82b208c3cf94ea4f9`) across all workflow files. This resolves the GitHub Actions automatic failure due to the cache v1/v2 deprecation.

Files changed:
- `.github/workflows/regression.yml` — 2 occurrences (setup job node_modules cache, playwright job browser cache)
- `.github/workflows/cross-browser.yml` — 2 occurrences (both node_modules caches)

No other workflow files are affected. The v4 SHA `0c45773b623bea8c8e75f6c82b208c3cf94ea4f9` corresponds to `actions/cache@v4.0.2`, the current stable release.