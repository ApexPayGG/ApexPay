# ApexPay API — przegląd endpointów

Base URL produkcji: `https://api.apexpay.pl`. Wiele tras jest zdublowanych pod **`/api/...`** i **`/api/v1/...`** (ta sama logika).

## Konwencje

- **JSON**: `Content-Type: application/json` tam, gdzie jest body.
- **Auth (JWT)**: cookie `jwt` (httpOnly) po logowaniu **lub** nagłówek `Authorization: Bearer <token>`.
- **Komunikaty**: część endpointów zwraca teksty po polsku, część po angielsku — przed frontem warto ujednolicić w jednej iteracji.

## Auth

| Metoda | Ścieżka | Auth | Opis |
|--------|---------|------|------|
| POST | `/api/v1/auth/register`, `/api/auth/register` | — | Rejestracja. `role: ADMIN` zwraca **403**. Sukces: `message`, `userId`. |
| POST | `/api/v1/auth/login`, `/api/auth/login` | — | Logowanie. Odpowiedź: `token`, `id`, `email`, `role`, … + cookie `jwt`. |
| GET | `/api/v1/auth/me`, `/api/auth/me` | Bearer / cookie | Profil z bazy (`id`, `email`, `role`, …). |

## Portfel

| Metoda | Ścieżka | Auth | Opis |
|--------|---------|------|------|
| GET | `/api/v1/wallet/me`, `/api/wallet/me` | Bearer / cookie | Saldo: `walletId`, `balance` (string), `updatedAt`. |
| POST | `/api/v1/wallet/fund`, `/api/wallet/fund` | Bearer / cookie + **rola ADMIN** | Zasilenie konta: body `{ "targetUserId", "amount" }` (`amount` jako string cyfr). Tworzy wpis **`Transaction`** typu `DEPOSIT` z `referenceId` prefiks `admin-fund-`. |
| POST | `/api/wallet/deposit` | Bearer / cookie | Wpłata z referencją zewnętrzną (`amount`, `referenceId`). |
| POST | `/api/wallet/charge` | Bearer / cookie | Opłata / pobranie z portfela (`amount`, `referenceId`). |

## Turnieje i mecze (skrót)

| Metoda | Ścieżka | Auth |
|--------|---------|------|
| POST | `/api/tournaments` | tak |
| POST | `/api/tournaments/:id/join` | tak |
| POST | `/api/tournaments/:id/cancel` | tak |
| POST | `/api/matches/:id/report` | tak |
| POST | `/api/matches/:id/resolve` | tak |
| POST | `/api/v1/matches/:id/resolve` | tak (+ HMAC, rate limit, idempotencja) |

## Webhooki

| Metoda | Ścieżka | Auth |
|--------|---------|------|
| POST | `/internal/webhooks/psp-deposit` | zgodnie z implementacją kontrolera |

## Planowane (nie wdrożone w tej iteracji)

- **P2P** / przelewy między graczami jako osobna trasa.
- **Frontend** — osobny projekt / repo.

## Bezpieczeństwo

- Nie commituj **`.env`**, **`test.http`** (z tokenami) ani prawdziwych sekretów. W repozytorium jest **`test.http.example`** — skopiuj do lokalnego `test.http` (`cp test.http.example test.http`).
- Po wycieku **JWT** lub **JWT_SECRET**: wygeneruj nowy sekret, zdeployuj, wymuś ponowne logowanie użytkowników.
