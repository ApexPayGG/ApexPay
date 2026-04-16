# ApexPay API — przegląd endpointów

Base URL produkcji: `https://api.apexpay.pl`. Wiele tras jest zdublowanych pod **`/api/...`** i **`/api/v1/...`** (ta sama logika).

- **OpenAPI (szkic)**: [openapi.yaml](./openapi.yaml)
- **Rotacja sekretów**: [operations/SECRETS_ROTATION.md](./operations/SECRETS_ROTATION.md)

## Konwencje

- **JSON**: `Content-Type: application/json` tam, gdzie jest body.
- **Auth (JWT)**: cookie `jwt` (httpOnly) po logowaniu **lub** nagłówek `Authorization: Bearer <jwt>` (token JWT zwykle zaczyna się od `eyJ…`). Używane m.in. przez SAFE TAXI i panel użytkownika.
- **Auth (klucz API — integracje B2B)**: alternatywa do JWT na **wybranych** trasach (np. `GET /api/v1/integrations/me`). Nagłówek **`x-api-key: apx_live_…`** albo **`Authorization: Bearer apx_live_…`** (tylko gdy wartość po `Bearer ` zaczyna się od `apx_live_`; tokeny JWT nadal używają tego samego nagłówka z prefiksem `eyJ`). Klucz jest hashowany w bazie (`bcrypt`); surowy sekret znany jest tylko przy **`POST /api/v1/api-keys`** (wymaga JWT).
- **Błędy (nowsze endpointy)**: często `{ "error": "…", "code": "SNAKE_CASE" }` (np. `BAD_REQUEST`, `UNAUTHORIZED`).
- **Legacy `/api/...`**: nagłówki **`Deprecation: true`**, **`Sunset`**, **`Link`** — preferuj **`/api/v1/...`**.
- **Rate limit**: **POST** `/auth/register` i `/auth/login` — ok. **25 żądań / 60 s / IP** (Redis); przy przekroczeniu **429** z `code: TOO_MANY_REQUESTS`.
- **Paginacja kursorowa (listy integratora / klucze API)**: opcjonalne query **`limit`** (1–50, domyślnie **20**) oraz **`cursor`** — wartość **`nextCursor`** z poprzedniej odpowiedzi (base64url z ISO-8601 `createdAt` ostatniego elementu strony). Kolejne strony: rekordy z **`createdAt` starszym** niż data z kursora, sort **malejąco** po `createdAt`. Odpowiedź: `{ "items": [ … ], "nextCursor": string | null }` — `nextCursor` jest **`null`**, gdy nie ma kolejnej strony.

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

## Klucze API (integrator)

| Metoda | Ścieżka | Auth | Opis |
|--------|---------|------|------|
| GET | `/api/v1/api-keys` | JWT | Lista kluczy zalogowanego użytkownika: `{ "status": "success", "data": { "items": [ { id, prefix, name, createdAt, … } ], "nextCursor": string \| null } }` (bez pełnego sekretu). Query: opcjonalnie **`limit`**, **`cursor`** (paginacja kursorowa po `createdAt`). |
| POST | `/api/v1/api-keys` | JWT | Utworzenie klucza: `{ "name": "…", "expiresAt"?: ISO-8601 }`. Odpowiedź **201** zawiera pole **`key`** (pełny klucz `apx_live_…`) tylko raz — zapisz go bezpiecznie. Audyt: **`API_KEY_CREATED`**. |
| DELETE | `/api/v1/api-keys/:id` | JWT | Usunięcie klucza użytkownika (**204**). Audyt: **`API_KEY_DELETED`**. |
| GET | `/api/v1/integrations/me` | **klucz API** (`x-api-key` lub `Bearer apx_live_…`) | Zwraca `{ userId, role }` powiązane z kluczem — do testu integracji. |
| GET | `/api/v1/integrations/accounts` | **klucz API** **lub JWT** | Lista subkont integratora: `{ "status": "success", "data": { "items": [ … ], "nextCursor": string \| null } }` — pola elementów: `"id", "email", "type"` (`INDIVIDUAL` \| `COMPANY`), `"country", "status", "createdAt"` (ISO-8601); bez `userId` / `kycReferenceId`. Query: **`limit`**, **`cursor`** (paginacja po `createdAt`). |
| POST | `/api/v1/integrations/accounts` | **klucz API** **lub JWT** | Onboarding KYC (F3): body `{ "email", "type": "INDIVIDUAL" \| "COMPANY", "country": "PL" }` (`country` — ISO 3166-1 alpha-2). Tworzy `ConnectedAccount` powiązany z integratorem (`integratorUserId`), status domyślnie **`PENDING`**. Duplikat `(integrator, email)` → **409** `CONFLICT`. |
| GET | `/api/v1/integrations/charges` | **klucz API** **lub JWT** | Lista charge’ów integratora: `{ "status": "success", "data": { "items": [ … ], "nextCursor": string \| null } }` — elementy: `"id", "amountCents", "currency", "createdAt", "connectedAccountIds"` (`amountCents` w **groszach** jako string; `connectedAccountIds` z ledgera). Query: **`limit`**, **`cursor`**. |
| GET | `/api/v1/integrations/charges/export` | **klucz API** **lub JWT** | Eksport CSV charge’ów integratora. Query: `from` (ISO date, opcjonalnie), `to` (ISO date, opcjonalnie), `limit` (opcjonalnie, max `5000`, domyślnie `5000`). Kolumny: `ID`, `Kwota (PLN)`, `Waluta`, `Subkonto ID`, `Status`, `Data utworzenia`. Odpowiedź: `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="charges_YYYY-MM-DD.csv"`. |
| POST | `/api/v1/integrations/charges` | **klucz API** | Marketplace charge ze splitem: nagłówek **`Idempotency-Key`** (wymagany, string, do 256 znaków; idempotencja Redis `idemp:mkt-charge:{key}` — powtórka w 24 h → **409**). Body: `amount` (int > 0, grosze), `currency` (np. `PLN`), `paymentMethodId` (opcjonalnie — musi należeć do integratora), `splits`: `[{ connectedAccountId, amount }]` (suma `amount` ≤ `amount` całkowitego; reszta = prowizja platformy na portfel integratora). Portfel integratora jest obciążany pełnym `amount`; subkonta muszą należeć do **tego samego integratora**, mieć status **`ACTIVE`** oraz powiązanie z użytkownikiem (`userId`); w przeciwnym razie **403** (`FORBIDDEN` lub walidacja). Wpisy ledger `mkt:{chargeId}:debit`, `mkt:…:credit:{connectedAccountId}`, ewent. `mkt:…:credit:platform`. **Fraud:** przed księgowaniem synchroniczna ocena (`FraudCheck`); przy **`BLOCKED`** odpowiedź **422** z `code: FRAUD_BLOCKED`, `fraudCheckId`, `score`; przy **`FLAGGED`** charge jest tworzony, pole opcjonalne `fraudCheckId` w odpowiedzi i w audycie. |
| GET | `/api/v1/integrations/charges/:chargeId/refunds` | **klucz API** **lub JWT** | Lista zwrotów (`Refund`) dla danego charge integratora: `{ "status": "success", "data": { "items": [ … ] } }` — sort malejąco po `createdAt`. |
| POST | `/api/v1/integrations/charges/:chargeId/refunds` | **klucz API** **lub JWT** | Zwrot częściowy/pełny: nagłówek **`Idempotency-Key`** (wymagany; Redis `idemp:refund:{key}`, 24 h → **409** przy powtórce). Body: `amount` (int > 0, grosze), `coveredBy`: `"PLATFORM"` \| `"CONNECTED_ACCOUNT"` \| `"SPLIT"` (kto ponosi koszt zwrotu), opcjonalnie `reason` (string, max 255). Limit **180 dni** od `createdAt` charge; suma zwrotów `SUCCEEDED` nie może przekroczyć kwoty charge. Ledger: `REFUND_DEBIT` (źródła), `REFUND_CREDIT` na portfel płatnika (`debitUserId`), `referenceId` `ref:{refundId}:credit` oraz `ref:{refundId}:debit:…`. **PLATFORM** — debet portfela użytkownika platformy (`APEXPAY_PLATFORM_USER_ID` lub `SAFE_TAXI_PLATFORM_USER_ID`). **CONNECTED_ACCOUNT** — tylko subkonta z oryginalnego splitu (debet może zejść poniżej zera). **SPLIT** — proporcjonalnie do składowych `credit:platform` vs `credit:{subkonto}` z ledgera charge. Audyt **`CHARGE_REFUNDED`**, outbox **`charge.refunded`**. |
| GET | `/api/v1/integrations/payouts` | **klucz API** **lub JWT** | Lista wypłat: `{ "status": "success", "data": { "items": [ … ], "nextCursor": string \| null } }` — kwoty w groszach (string). Query: **`limit`**, **`cursor`**. |
| GET | `/api/v1/integrations/payouts/export` | **klucz API** **lub JWT** | Eksport CSV wypłat integratora. Query: `from` (ISO date, opcjonalnie), `to` (ISO date, opcjonalnie), `limit` (opcjonalnie, max `5000`, domyślnie `5000`). Kolumny: `ID`, `Kwota (PLN)`, `Waluta`, `Subkonto ID`, `Status`, `PSP Reference ID`, `Data utworzenia`. Odpowiedź: `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="payouts_YYYY-MM-DD.csv"`. |
| POST | `/api/v1/integrations/payouts` | **klucz API** | Wypłata z portfela beneficjenta subkonta: nagłówek **`Idempotency-Key`** (wymagany; Redis `idemp:payout:{key}`, 24 h → **409** przy powtórce). Body: `{ "amount" (int > 0, grosze), "connectedAccountId" }`. Subkonto musi być **ACTIVE**, należeć do integratora i mieć powiązany `userId` (portfel). **402** przy braku środków. Ledger: `Transaction` `PAYOUT_DEBIT`, `referenceId` `pout:{payoutId}` (kwota ujemna). **201** + rekord `Payout` (`status` domyślnie `PENDING`). Zapis outbox **`payout.created`**. **Fraud:** ocena po `userId` beneficjenta; **`BLOCKED`** → **422** `FRAUD_BLOCKED` (`fraudCheckId`, `score`); **`FLAGGED`** → `fraudCheckId` w rekordzie. Szczegóły: [Wypłaty (Pay-outs)](#wypłaty-pay-outs). |

## Wypłaty (Pay-outs)

Integrator zleca wypłatę z **portfela użytkownika powiązanego z subkontem** (`ConnectedAccount.userId`). Kwoty w **groszach** (integer w JSON). Waluta w MVP domyślnie **`PLN`** (pole w modelu; body endpointu nie przekazuje waluty).

- **Warunki:** subkonto istnieje, `integratorUserId` = właściciel klucza API, status **`ACTIVE`**, `userId` ≠ null.
- **Ledger:** jeden wpis `Transaction` typu **`PAYOUT_DEBIT`** z ujemną kwotą (debet salda portfela beneficjenta), `referenceId` = `pout:{uuid}`.
- **Model `Payout`:** `PENDING` \| `IN_TRANSIT` \| `PAID` \| `FAILED` (pola `pspReferenceId` na przyszłą integrację PSP).
- **Webhook:** w tej samej transakcji co księgowanie dodawany jest wpis **`WebhookOutbox`** z `eventType: "payout.created"` i payloadem `{ id, amount, currency, connectedAccountId }` (`amount` jako string).
- **Rozliczenie (admin):** `POST /api/v1/admin/payouts/:id/settle` — przy **FAILED** zwrot: ledger **`PAYOUT_REVERSAL`**, `referenceId` **`pout-void:{id}`** (kwota dodatnia na portfelu subkonta).

## Konfiguracja webhooków (integrator B2B)

| Metoda | Ścieżka | Auth | Opis |
|--------|---------|------|------|
| GET | `/api/v1/integrations/config` | **klucz API** **lub JWT** (cookie `jwt` / `Authorization: Bearer eyJ…`) | **200** `{ "status": "success", "data": { "id", "userId", "webhookUrl", "webhookSecret", "createdAt", "updatedAt" } }` albo **`data`: `null`**, jeśli brak zapisanej konfiguracji. Surowy `webhookSecret` — do weryfikacji podpisów po stronie integratora; przechowuj jak sekret. |
| PUT | `/api/v1/integrations/config` | **klucz API** **lub JWT** | Body (strict): `{ "webhookUrl": "<https URL>" \| null }` — `null` czyści URL. **Pierwszy** zapis tworzy rekord z nowym `webhookSecret`; kolejne zmieniają **tylko** `webhookUrl` (sekret bez zmian). **200** jak przy GET z niepustym `data`. |

### Odbieranie webhooków (outbox B2B)

Po udanym **`POST /api/v1/integrations/charges`**, **`POST /api/v1/integrations/charges/:chargeId/refunds`** lub **`POST /api/v1/integrations/payouts`** ApexPay zapisuje zdarzenie w kolejce outbox i okresowo (domyślnie co **10 s**, proces API — `server.ts`) wysyła **POST** na skonfigurowany `webhookUrl`.

- **Nagłówek** `x-apexpay-signature`: wartość **szesnastkowa** (lowercase) **HMAC-SHA256** obliczonego z **dokładnie tego samego ciągu UTF-8**, który jest ciałem żądania (`Content-Type: application/json`). Sekret: `webhookSecret` z konfiguracji integratora (`GET/PUT …/integrations/config`).
- **Weryfikacja po stronie integratora:** odczytaj surowe body jako string/buffer **przed** parsowaniem JSON, policz `HMAC-SHA256(body, webhookSecret)` → hex i porównaj z nagłówkiem (preferuj porównanie **timing-safe** na buforach bajtów zdekodowanych z hex).
- **Zdarzenie** `charge.succeeded` — przykładowy kształt JSON w body:
  - `id` — identyfikator charge (UUID),
  - `amount` — kwota całkowita charge w **groszach** (string cyfr),
  - `currency` — np. `PLN`,
  - `splits` — tablica `{ "connectedAccountId", "amount" }` (`amount` w groszach jako string); może być pusta, jeśli całość poszła na „platformę” integratora,
  - `status` — stała `"SUCCESS"` (charge zaksięgowany w sandboxie).
- **Zdarzenie** `charge.refunded` — payload m.in. `chargeId`, `refundId`, `amount` (grosze, string), `currency`, `coveredBy` (`PLATFORM` \| `CONNECTED_ACCOUNT` \| `SPLIT`).
- **Zdarzenie** `payout.created` — body JSON m.in. `id` (wypłata), `amount` (grosze, string), `currency`, `connectedAccountId`.
- **`payout.paid`** / **`payout.failed`** — po rozliczeniu przez admina (`POST …/admin/payouts/:id/settle`); w payloadzie m.in. `id`, `amount`, `currency`, `connectedAccountId`, `status`; przy sukcesie PSP opcjonalnie `pspReferenceId`.
- **Zdarzenia sporów (chargeback):** `dispute.created` — `{ disputeId, chargeId, amount, reason, evidenceDueBy }`; `dispute.won` / `dispute.lost` / `dispute.accepted` — po rozstrzygnięciu przez admina (`amount` w groszach jako string, `resolvedAt` ISO).

Przy braku URL lub konfiguracji wpis outbox przechodzi w stan **FAILED** (bez sensownej retry). Przy błędach HTTP / timeoutach stosowany jest backoff (**1 min → 5 min → 1 h**) i maks. **5** prób dostawy.

## Metody płatności (tokeny PSP, bez PAN)

| Metoda | Ścieżka | Auth | Opis |
|--------|---------|------|------|
| GET | `/api/v1/payment-methods` | tak | Lista metod użytkownika (`createdAt` malejąco). W odpowiedzi pole `token` jest maskowane (`[redacted]`). |
| POST | `/api/v1/payment-methods` | tak | Body: `provider` (`STRIPE` \| `ADYEN` \| `MOCK_PSP` \| `AUTOPAY`), `token`, `type` (np. `CARD`); opcjonalnie `last4` (4 znaki), `expMonth`, `expYear`, `isDefault`. Przy `isDefault: true` pozostałe metody użytkownika tracą domyślność. Duplikat `provider`+`token` (unikalność globalna) → **409** `CONFLICT`. Odpowiedź **201** z utworzonym rekordem (token zmaskowany). |
| POST | `/api/v1/payments/initiate` | tak | Inicjacja płatności redirect w Autopay BM: body `{ "amount": <grosze int>, "currency": "PLN" (domyślnie), "description": "..." }`. Odpowiedź: `{ "status": "success", "data": { "paymentUrl", "orderId" } }`, gdzie `orderId = dep:{userId}:{timestamp}`. |
| POST | `/api/v1/payments/ride-finalize` | **klucz API** | Finalizacja rozliczenia kursu (SAFE TAXI/B2B). Body: `{ "ride_id", "base_amount_grosze", "platform_commission_grosze", "driver_base_payout_grosze", "tip_amount_grosze" (domyślnie 0), "tip_settlement" (domyślnie `CREDIT_CONNECTED_ACCOUNT`), "passenger_rating_stars" (1-5, opcjonalnie), "driver_connected_account_id" }`. Walidacja biznesowa: `platform_commission_grosze + driver_base_payout_grosze === base_amount_grosze`. Idempotencja Redis: `idemp:ride-finalize:{ride_id}` (NX EX 86400); duplikat zwraca **200** `{ "rideId", "duplicate": true }`. Sukces: **201** `{ "rideId", "driverPayout", "platformCommission", "tip", "duplicate": false }`. Ledger refs: `ride:{ride_id}:debit`, `ride:{ride_id}:driver`, `ride:{ride_id}:platform`, `ride:{ride_id}:tip` (jeśli napiwek > 0). |

## SAFE TAXI (rozliczenie przejazdu)

Wymaga w `.env`: **`SAFE_TAXI_PLATFORM_USER_ID`**, opcjonalnie **`SAFE_TAXI_PLATFORM_COMMISSION_BPS`** (domyślnie `1500` = 15 %). Gotówka: opcjonalnie **`MAX_DRIVER_DEBT`** (≤ 0, minor units, np. `-10000` = dno salda -100 PLN) albo legacy **`MAX_DRIVER_DEBT_MINOR_UNITS`** (dodatnia wielkość długu → saldo ≥ `-wartość`).

| Metoda | Ścieżka | Auth | Opis |
|--------|---------|------|------|
| POST | `/api/v1/safe-taxi/rides` | tak (pasażer = JWT) | Body: `{ "driverUserId": "<CUID>", "paymentMethod"?: "CARD" \| "CASH" }` (domyślnie **CARD**). **`paymentMethod`**: sposób zapłaty za kurs; **CASH** włącza model zadłużenia kierowcy (prowizja z jego portfela przy `settle`). Przy limicie długu — **403** `DRIVER_DEBT_LIMIT`. |
| POST | `/api/v1/safe-taxi/rides/:id/settle` | kierowca tego przejazdu **lub** **ADMIN** | Body: `{ "fareCents": "12345" }` (grosze). **CARD**: debet pasażera, split (`SAFE_TAXI_PASSENGER_CHARGE` / `DRIVER_PAYOUT` / `PLATFORM_FEE`). **CASH**: bez debetu pasażera; transfer prowizji: debet kierowcy, kredyt platformy, typ **`SAFE_TAXI_COMMISSION_DEBIT`**, `referenceId` **`stx:{rideId}:commission_cash`** (kierowca) oraz **`stx:{rideId}:commission_cash:platform`**. Saldo kierowcy może być ujemne. Przekroczenie **`MAX_DRIVER_DEBT`** — **403** `DRIVER_DEBT_LIMIT`. |

## Marketplace (sandbox — wewnętrzny split na portfelach)

Bez PSP: **ADMIN** tworzy subkonto (`ConnectedAccount`) dla użytkownika z portfelem, ustawia status, potem uruchamia „charge” z podziałem na subkonta **ACTIVE**. Statusy subkont: `PENDING` (onboarding / KYC), `ACTIVE`, `RESTRICTED`, `REJECTED`. Pole `kycReferenceId` (opcjonalne, unikalne) — przyszłe mapowanie na dostawcę KYC. Kwoty w groszach (string cyfr w JSON). Opcjonalnie nagłówek **`Idempotency-Key`** przy `POST /charges`.

| Metoda | Ścieżka | Auth | Opis |
|--------|---------|------|------|
| POST | `/api/v1/connected-accounts` | **ADMIN** | Body: `{ "userId": "<CUID>" }` — tworzy rekord subkonta (status domyślnie **`PENDING`**). |
| PATCH | `/api/v1/connected-accounts/:id` | **ADMIN** | Body: `{ "status": "PENDING" \| "ACTIVE" \| "RESTRICTED" \| "REJECTED" }`. |
| POST | `/api/v1/charges` | **ADMIN** | Body: `{ "debitUserId", "amountCents": "123", "splits": [ { "connectedAccountId", "amountCents": "…" } ] }`. Suma `splits` musi równać `amountCents`. Split dozwolony tylko na subkonto **`ACTIVE`** (inny status → **403**). |

## Admin

| Metoda | Ścieżka | Auth | Opis |
|--------|---------|------|------|
| GET | `/api/v1/admin/transactions`, `/api/admin/transactions` | **ADMIN** | Query: `limit` (1–100), `page` (od 0), opcjonalnie `referenceIdPrefix` — filtr `referenceId` „zaczyna się od” (np. `stx:` przejazdy SAFE TAXI, `mkt:` marketplace). Zwraca `items`, `total`, `totalPages`. |
| GET | `/api/v1/admin/audit-logs`, `/api/admin/audit-logs` | **ADMIN** (JWT) | Odczyt append-only **AuditLog**. Query: `actorId`, `entityType`, `entityId`, `action` (wartość enumu `AuditAction`), `from` / `to` (daty ISO), `limit` (1–100, domyślnie 50), `cursor` (paginacja kursorowa po `createdAt` — wartość `nextCursor` z poprzedniej strony). Odpowiedź: `{ "items": [ { id, actorId, actorType, action, entityType, entityId, metadata, ipAddress, userAgent, createdAt } ], "nextCursor": string \| null }`. |
| POST | `/api/v1/admin/payouts/:id/settle`, `/api/admin/payouts/:id/settle` | **ADMIN** (JWT) | Rozliczenie wypłaty B2B: body `{ "status": "PAID" \| "FAILED", "pspReferenceId"?: string }`. Dozwolone tylko dla `Payout` w stanie **`PENDING`** lub **`IN_TRANSIT`**. **`PAID`**: ustawia status, opcjonalnie zapisuje `pspReferenceId`, outbox **`payout.paid`**, audyt **`PAYOUT_SETTLED`**. **`FAILED`**: status **FAILED**, **zwrot** na portfel subkonta, ledger `PAYOUT_REVERSAL`, `referenceId` `pout-void:{payoutId}`, outbox **`payout.failed`**, audyt **`PAYOUT_FAILED`**. Ponowne rozliczenie → **409** `CONFLICT`. |
| GET | `/api/v1/admin/disputes`, `/api/admin/disputes` | **ADMIN** (JWT) | Lista sporów PSP: query `status` (`DisputeStatus`), `from` / `to` (ISO, filtr po `createdAt`), `limit` (1–100), `cursor` (`nextCursor` z poprzedniej strony). Odpowiedź: `{ "status": "success", "data": { "items", "nextCursor" } }` — kwoty `amount` jako string (grosze). |
| GET | `/api/v1/admin/disputes/:id` | **ADMIN** (JWT) | Szczegóły sporu. **404** jeśli brak rekordu. |
| POST | `/api/v1/admin/disputes/:id/evidence` | **ADMIN** (JWT) | Body: `{ "evidence": { … } }` (dowody JSON). Ustawia `EVIDENCE_SUBMITTED`, audyt **`DISPUTE_EVIDENCE_SUBMITTED`**. |
| POST | `/api/v1/admin/disputes/:id/resolve` | **ADMIN** (JWT) | Body: `{ "outcome": "WON" \| "LOST" \| "ACCEPTED" }`. Ledger: **WON** — `DISPUTE_HOLD_RELEASE` (zwrot holdu na portfel integratora); **LOST** / **ACCEPTED** — para `DISPUTE_HOLD_RELEASE` + `DISPUTE_DEBIT_FINAL` (saldo jak po `DISPUTE_HOLD`). Outbox: `dispute.won` / `dispute.lost` / `dispute.accepted`. Audyt **`DISPUTE_RESOLVED`**. |
| GET | `/api/v1/admin/fraud-checks`, `/api/admin/fraud-checks` | **ADMIN** (JWT) | Lista `FraudCheck`: query `status`, `userId`, `entityType`, `from` / `to`, `limit`, `cursor`. |
| GET | `/api/v1/admin/fraud-checks/:id` | **ADMIN** (JWT) | Szczegóły rekordu oceny (score, `rulesTriggered`, metadata). |
| POST | `/api/v1/admin/fraud-checks/:id/review` | **ADMIN** (JWT) | Body: `{ "decision": "APPROVE" \| "CONFIRM_FRAUD" }` — ustawia `reviewedBy`, `reviewedAt`; audyt **`FRAUD_REVIEWED`**. |
| GET | `/api/v1/admin/analytics/overview` | **ADMIN** (JWT) | KPI dla panelu analitycznego. Query: `from`, `to` (ISO; domyślnie ostatnie 30 dni). Odpowiedź zawiera: `totalCharges`, `totalPayouts`, `totalRefunds` (count + `amountPln`), `fraudBlocked`, `fraudFlagged`, `activeConnectedAccounts`, `pendingDisputes`. |
| GET | `/api/v1/admin/analytics/revenue-chart` | **ADMIN** (JWT) | Szereg czasowy przepływów finansowych. Query: `from`, `to` (ISO), `granularity` (`day` \| `week` \| `month`). Odpowiedź: `[{ date, chargesAmount, payoutsAmount, refundsAmount }]` (kwoty w PLN). |
| GET | `/api/v1/admin/analytics/fraud-chart` | **ADMIN** (JWT) | Dzienna agregacja fraud checks. Query: `from`, `to` (ISO). Odpowiedź: `[{ date, blocked, flagged, passed }]`. |
| GET | `/api/v1/admin/webhook-dead-letters`, `/api/admin/webhook-dead-letters` | **ADMIN** (JWT) | Dead letter webhooków B2B (po **5** nieudanych próbach dostawy wpis jest usuwany z `WebhookOutbox` i trafia tutaj). Query: `integratorUserId`, `requeued` (`true` \| `false`), `from` / `to` (ISO, `createdAt`), `limit` (1–50, domyślnie 20), `cursor` (paginacja kursorowa po `createdAt`). Odpowiedź: `{ "status": "success", "data": { "items", "nextCursor" } }`. |
| POST | `/api/v1/admin/webhook-dead-letters/:id/requeue`, `/api/admin/webhook-dead-letters/:id/requeue` | **ADMIN** (JWT) | Ponowna kolejka: tworzy nowy **`WebhookOutbox`** (`PENDING`, `attempts: 0`), ustawia na dead letter `requeued`, `requeuedAt`, `requeuedBy`; audyt **`WEBHOOK_REQUEUED`**. **200** `{ "status": "success", "data": { "outboxId" } }`. Ponowne wywołanie dla tego samego dead letter → **409** `CONFLICT`. **404** gdy brak id. |

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
| POST | `/internal/webhooks/psp-deposit` | HMAC nagłówek `x-apexpay-signature` (hex SHA-256 surowego JSON body; sekret `PSP_DEPOSIT_WEBHOOK_SECRET`). Body: `{ "pspRefId", "amount" (int, minor units), "userId", "currency", "status": "SUCCESS" \| "FAILED" \| "PENDING" }`. Idempotencja: Redis `idemp:deposit:{pspRefId}` + ledger `dep:{pspRefId}`. |
| POST | `/internal/webhooks/psp-dispute` | Ten sam HMAC co wpłata (`PSP_DEPOSIT_WEBHOOK_SECRET`, nagłówek `x-apexpay-signature`). Body (strict): `{ "pspDisputeId", "chargeId", "reason" (enum `DisputeReason`), "amount" (int > 0, grosze), "currency", "evidenceDueBy" (ISO-8601) }`. Tworzy `Dispute`, ledger **`DISPUTE_HOLD`** na portfelu integratora (`referenceId` `disp:{disputeId}:hold`), outbox **`dispute.created`**, audyt **`DISPUTE_CREATED`**. Idempotencja: Redis `idemp:dispute:{pspDisputeId}` + unikalność `pspDisputeId` w DB. Powtórka → **200** z `duplicate: true`. |
| POST | `/internal/webhooks/autopay-itn` | ITN Autopay BM (form-urlencoded): pole `transactions` zawiera **base64 XML**. Weryfikacja hash SHA-256 po polach `ServiceID|OrderID|RemoteID|Amount|Currency|PaymentStatus|SHARED_KEY`. Idempotencja: Redis `idemp:autopay-itn:{OrderID}:{RemoteID}`. Dla `PaymentStatus=SUCCESS` księgowanie wpłaty (`dep:{RemoteID}`) na podstawie `OrderID` (`dep:{userId}:{timestamp}`), opcjonalnie zapis metody `AUTOPAY` z `CustomerHash` (`type: AUTOPAY_RECURRING`). Odpowiedź zawsze **200 XML** (`CONFIRMED` lub XML błędu przy niepoprawnym hash/payload). |

## Integracja PSP (Autopay BM)

- Wymagane ENV: `AUTOPAY_SERVICE_ID`, `AUTOPAY_SHARED_KEY`, `AUTOPAY_GATEWAY_URL`, `AUTOPAY_RETURN_URL`, `AUTOPAY_ITN_URL`.
- Bramka: sandbox `https://pay-accept.bm.pl`, produkcja `https://pay.bm.pl`.
- Inicjacja (`/api/v1/payments/initiate`) zwraca URL redirect (`GET`) z parametrami `ServiceID`, `OrderID`, `Amount`, `Description`, `CustomerEmail`, `Hash`.
- Hash inicjacji: `ServiceID|OrderID|Amount|Description|CustomerEmail|SHARED_KEY` (SHA-256 hex lowercase).
- ITN hash: `ServiceID|OrderID|RemoteID|Amount|Currency|PaymentStatus|SHARED_KEY`.

## CI / CD

- **CI**: PR + push `main` — `prisma validate`, testy.
- **Deploy production**: po **sukcesie CI** na `main`, ten sam **`head_sha`**.

## Bezpieczeństwo

- Nie commituj **`.env`**, **`test.http`** z tokenami. Szablon: **`test.http.example`**.
- Szczegóły rotacji: **`docs/operations/SECRETS_ROTATION.md`**.
