# ApexPay API — przegląd endpointów

Base URL produkcji: `https://api.apexpay.pl`. Wiele tras jest zdublowanych pod **`/api/...`** i **`/api/v1/...`** (ta sama logika).

- **OpenAPI (szkic)**: [openapi.yaml](./openapi.yaml)
- **Rotacja sekretów**: [operations/SECRETS_ROTATION.md](./operations/SECRETS_ROTATION.md)

## Konwencje

- **JSON**: `Content-Type: application/json` tam, gdzie jest body.
- **Auth (JWT)**: cookie `jwt` (httpOnly) po logowaniu **lub** nagłówek `Authorization: Bearer <token>`.
- **Błędy (nowsze endpointy)**: często `{ "error": "…", "code": "SNAKE_CASE" }` (np. `BAD_REQUEST`, `UNAUTHORIZED`).
- **Legacy `/api/...`**: nagłówki **`Deprecation: true`**, **`Sunset`**, **`Link`** — preferuj **`/api/v1/...`**.
- **Rate limit**: **POST** `/auth/register` i `/auth/login` — ok. **25 żądań / 60 s / IP** (Redis); przy przekroczeniu **429** z `code: TOO_MANY_REQUESTS`.

## Health (bez prefiksu `/api`)

| Metoda | Ścieżka | Opis |
|--------|---------|------|
| GET | `/health` | Liveness — proces działa. |
| GET | `/health/ready` | Readiness — DB (`SELECT 1`) + Redis `PING`. **503** jeśli zależność niedostępna. |

## Statyczne (dev / wewnętrznie)

| Zasób | Opis |
|-------|------|
| GET | `/admin-mini.html` — minimalny panel (lista transakcji admina, health); token wklejasz w przeglądarce. |

## Auth

| Metoda | Ścieżka | Auth | Opis |
|--------|---------|------|------|
| POST | `/api/v1/auth/register`, `/api/auth/register` | — | Rejestracja. `role: ADMIN` → **403**. Sukces: `message`, `userId`. |
| POST | `/api/v1/auth/login`, `/api/auth/login` | — | Logowanie: `token`, `id`, `email`, `role`, … + cookie `jwt`. |
| GET | `/api/v1/auth/me`, `/api/auth/me` | Bearer / cookie | Profil z bazy. |

## Portfel

| Metoda | Ścieżka | Auth | Opis |
|--------|---------|------|------|
| GET | `/api/v1/wallet/me`, `/api/wallet/me` | tak | Saldo: `walletId`, `balance`, `updatedAt`. |
| POST | `/api/v1/wallet/transfer`, `/api/wallet/transfer` | tak | **P2P**: `{ "toUserId", "amount" (string cyfr), "referenceId" }`. Idempotentnie po `referenceId` (wewnętrznie `p2p:{ref}:out` / `:in`). |
| POST | `/api/v1/wallet/fund`, `/api/wallet/fund` | **ADMIN** | Zasilenie: `{ "targetUserId", "amount" }` + wpis `Transaction` `DEPOSIT` (`admin-fund-…`). |
| POST | `/api/wallet/deposit` | tak | Wpłata zewnętrzna (`amount`, `referenceId`). |
| POST | `/api/wallet/charge` | tak | Opłata (`amount`, `referenceId`). |

## Admin

| Metoda | Ścieżka | Auth | Opis |
|--------|---------|------|------|
| GET | `/api/v1/admin/transactions`, `/api/admin/transactions` | **ADMIN** | Query: `limit` (1–100), `page` (od 0). Zwraca `items`, `total`, `totalPages`. |

## Turnieje i mecze (skrót)

| Metoda | Ścieżka | Auth |
|--------|---------|------|
| GET | `/api/tournaments` | tak | Query: `limit` (1–50, domyślnie 20), opcjonalnie `status` (`REGISTRATION` / `IN_PROGRESS` / `COMPLETED` / `CANCELED`). |
| GET | `/api/tournaments/:id` | tak | Szczegół + uczestnicy (`userId`, `joinedAt`) + mecze (drabinka: `roundNumber`, `status`, gracze, `winnerId`, `awardsTournamentPrize`). |
| POST | `/api/tournaments` | tak |
| POST | `/api/tournaments/:id/join` | tak |
| POST | `/api/tournaments/:id/start` | tak (organizator) |
| POST | `/api/tournaments/:id/cancel` | tak |
| POST | `/api/matches/:id/report` | tak |
| POST | `/api/matches/:id/resolve` | tak |
| POST | `/api/v1/matches/:id/resolve` | tak (+ HMAC, rate limit, idempotencja) |

**Start turnieju** (`POST .../start`): odpowiedź zawiera `data.round1` — tablica `{ matchId, playerAId, playerBId }` (pary wg kolejności zapisów). Przy meczach bez przypisanych graczy (dane sprzed migracji) walidacja raportu nie wymusza listy zawodników.

**Drabinka (single elimination):** mecze mają `roundNumber`; wypłata puli turnieju (`PRIZE_PAYOUT`) następuje tylko przy meczu z `awardsTournamentPrize` (finał lub turniej 1×1). Po zamknięciu wszystkich meczów rundy (konsensus / `RESOLVED`, albo rozliczenie v1 `SETTLED`) silnik tworzy kolejną rundę albo ustawia turniej na `COMPLETED`.

## Webhooki

| Metoda | Ścieżka | Auth |
|--------|---------|------|
| POST | `/internal/webhooks/psp-deposit` | wg kontrolera |

## CI / CD

- **CI**: PR + push `main` — `prisma validate`, testy.
- **Deploy production**: po **sukcesie CI** na `main`, ten sam **`head_sha`**.

## Bezpieczeństwo

- Nie commituj **`.env`**, **`test.http`** z tokenami. Szablon: **`test.http.example`**.
- Szczegóły rotacji: **`docs/operations/SECRETS_ROTATION.md`**.
