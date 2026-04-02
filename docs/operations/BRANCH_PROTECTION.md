# Branch Protection (Main)

Minimum settings recommended for `main` in GitHub branch protection:

1. Require a pull request before merging.
2. Require approvals (at least 1).
3. Require status checks to pass before merging.
4. Restrict direct pushes to `main` (except administrators if necessary).

## Required status checks

Use these checks from workflow `CI`:

- `Secrets Scan`
- `Test`

These checks enforce:

- secret leak scanning (`gitleaks`)
- lint + typecheck + tests + build (api + web)

## Why this matters

- prevents accidental secret leaks (`.env`, tokens, keys)
- blocks merges that break frontend/backend build or tests
- stabilizes release quality before deployment workflows run

