# Branch Protection (Main)

Minimum settings recommended for `main` in GitHub branch protection:

1. Require a pull request before merging.
2. Require approvals (at least 1).
3. Require status checks to pass before merging.
4. Restrict direct pushes to `main` (except administrators if necessary).

## Required status checks

W interfejsie GitHub pełna nazwa checka to zwykle **`Nazwa workflow / Nazwa joba`** (nie samo `Test`).

Dla pliku `.github/workflows/ci.yml` (pierwsza linia: `name: CI`) użyj dokładnie:

- **`CI / Secrets Scan`**
- **`CI / Test`**

W wyszukiwarce „Dodaj czeki” wybierz wpisy, które **dokładnie** tak wyglądają (czasem dopisek `(pull_request)` jest tylko w widoku PR — w regule zapisuje się sama para workflow/job).

### Typowy błąd: „Czekam na status” mimo zielonego CI

Jeśli w regułach masz np. **`secrets scan`** lub samo **`test`** (małe litery, bez prefiksu `CI /`), GitHub **będzie czekał w nieskończoność**, bo **żaden job tak się nie nazywa**. Usuń te wpisy i dodaj **`CI / Secrets Scan`** oraz **`CI / Test`**.

Opcjonalnie, jeśli chcesz wymuszać też stress testy, dodaj check z workflow **Transaction stress tests** (nazwa dokładnie jak w **Akcje** po ostatnim zielonym uruchomieniu).

These checks enforce:

- secret leak scanning (`gitleaks`)
- lint + typecheck + tests + build (api + web)

## Why this matters

- prevents accidental secret leaks (`.env`, tokens, keys)
- blocks merges that break frontend/backend build or tests
- stabilizes release quality before deployment workflows run

