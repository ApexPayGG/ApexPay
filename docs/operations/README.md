# Operacje ApexPay

Indeks dokumentów w tym katalogu:

| Dokument | Temat |
|----------|--------|
| [FIRST_TIME_SETUP.md](./FIRST_TIME_SETUP.md) | Pierwsze wdrożenie, `.env.prod`, Traefik, GHCR |
| [SECRETS_ROTATION.md](./SECRETS_ROTATION.md) | Rotacja JWT, DB, Redis, RabbitMQ |
| [BRANCH_PROTECTION.md](./BRANCH_PROTECTION.md) | Ochrona gałęzi i review |
| [CLOUD_SECURITY_ROADMAP.md](./CLOUD_SECURITY_ROADMAP.md) | Etapy chmury i bezpieczeństwa |

## Logi strukturalne (produkcja)

API loguje w **JSON** (Pino). Każde żądanie HTTP ma **`traceId`**: nagłówek wejściowy `x-trace-id` (jeśli poda zaufany upstream) lub wygenerowany UUID; ten sam identyfikator jest zwracany w odpowiedzi w `x-trace-id` i dołączany do wpisów access log oraz `contextLogger()`.

**Zmienne:** `LOG_LEVEL` (domyślnie `info`; lokalnie `npm run dev:api` ustawia `debug`). W dev używany jest `pino-pretty` (czytelny terminal); w `NODE_ENV=production` — czysty JSON, jedna linia na rekord.

**Filtrowanie po `traceId`:** w logach agregowanych (stdout → Docker / platforma) szukaj pola `traceId` lub `req.id` (pino-http). Przykład z `jq` przy strumieniu z kontenera:

```bash
docker logs apexpay-api 2>&1 | jq -c 'select(.traceId == "WSTAW_UUID")'
```

Integrator może przekazać **`traceId`** z odpowiedzi błędu API (pole w JSON) przy zgłoszeniu do wsparcia.

## Webhooki B2B — Dead Letter Queue

Po **5** nieudanych próbach dostarczenia (HTTP non-2xx, timeout, błąd sieci) lub gdy integrator **nie ma skonfigurowanego URL** webhooka, rekord jest **usuwany** z tabeli `webhook_outboxes` i zapisywany w **`webhook_dead_letters`** (`originalOutboxId` zachowuje identyfikator usuniętego outboxa). Dzięki temu worker nie iteruje w nieskończoności po wpisach „na stałe FAILED”, a zespół operacyjny ma jedno miejsce do przeglądu i ręcznego **requeue** (`POST /api/v1/admin/webhook-dead-letters/:id/requeue` — JWT roli **ADMIN**), co tworzy świeży wpis outboxa i audyt **`WEBHOOK_REQUEUED`**.

**Monitoring:** w `server.ts` co **1 h** (wspólny tick z alertami terminów dowodów sporów) liczona jest liczba dead letters z **ostatnich 24 h** z `requeued = false`. Gdy przekroczy próg **`DEAD_LETTER_ALERT_THRESHOLD`** (domyślnie **10**, patrz `.env.example`), logowane jest ostrzeżenie `contextLogger().warn` z polami `deadLetterCount24hUnrequeued` i `threshold`.

## Autopay / Blue Media (v2.22.1)

- Inicjacja płatności redirect przez `POST /api/v1/payments/initiate` (JWT): API zwraca URL do bramki Autopay (`AUTOPAY_GATEWAY_URL`) i `orderId` (`dep:{userId}:{timestamp}`).
- ITN endpoint: `POST /internal/webhooks/autopay-itn` przyjmuje `application/x-www-form-urlencoded` z polem `transactions` (base64 XML).
- Weryfikacja integralności ITN opiera się o hash SHA-256 (`ServiceID|OrderID|RemoteID|Amount|Currency|PaymentStatus|SHARED_KEY`).
- Idempotencja ITN: `idemp:autopay-itn:{OrderID}:{RemoteID}` (Redis, 24 h).
- `PaymentStatus=SUCCESS` księguje wpłatę (`WalletService.depositFundsPspWebhook`) i opcjonalnie zapisuje `CustomerHash` jako `PaymentMethod(provider=AUTOPAY, type=AUTOPAY_RECURRING)` pod przyszłe płatności one-click.

## Rate limiting (Redis)

API używa middleware opartego o Redis (`INCR` + `PEXPIRE` przy pierwszym żądaniu) i nagłówki:
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

- `RATE_LIMIT_AUTH_MAX` — `POST /api/v1/auth/*` (okno 15 min, klucz IP + email jeśli dostępny).
- `RATE_LIMIT_PAYMENTS_MAX` — `POST /api/v1/payments/initiate` (okno 15 min, per IP).
- `RATE_LIMIT_API_GENERAL_MAX` — globalnie `/api/v1/*` (okno 1 min), z wyłączeniem tras z dedykowanymi limiterami.
- `RATE_LIMIT_WEBHOOKS_MAX` — `POST /internal/webhooks/*` (okno 1 min).
- `RATE_LIMIT_ADMIN_MAX` — `GET|POST /api/v1/admin/*` (okno 1 min).
- `RATE_LIMIT_TRUSTED_IPS` — CSV IP pomijanych przez limiter (np. monitoring, CI/CD, reverse proxy health-checki).

Przekroczenie limitu zwraca `429`:
`{ "error": "TOO_MANY_REQUESTS", "retryAfter": <sekundy>, "message": "..." }`.
Zdarzenie jest logowane (`contextLogger().warn`) z `ip`, `path`, `keyPrefix`, `traceId`.

## Fraud detection (scoring)

Przed **`POST …/integrations/charges`** i **`POST …/integrations/payouts`** wykonywana jest synchroniczna ocena reguł (`src/lib/fraud-rules.ts`): m.in. velocity charge/payout, nietypowa kwota, duplikat kwoty, podejrzenie card testing, wiek konta vs pierwszy duży charge, stosunek refundów, spike wypłat. Wynik w **`FraudCheck`** (`status`: `PASSED` \| `FLAGGED` \| `BLOCKED`, `score` 0–100, `rulesTriggered` JSON). Progi i limity przez zmienne **`FRAUD_*`** (patrz `.env.example`). Przy **`BLOCKED`** API zwraca **422** (`FRAUD_BLOCKED`, `fraudCheckId`, `score`). Przy **`FLAGGED`** operacja jest kontynuowana; opcjonalne powiązanie `fraudCheckId` na charge/payout. Audyt przy **FLAGGED** / **BLOCKED**: **`FRAUD_FLAGGED`** / **`FRAUD_BLOCKED`**. W `server.ts` co **5 min** log ostrzegawczy, gdy są nierozpatrzone **`FLAGGED`** z ostatniej godziny (`reviewedAt IS NULL`).

## Dane finansowe (skrót modelu)

| Element | Opis |
|---------|------|
| **`RefundStatus`** | `PENDING` \| `SUCCEEDED` \| `FAILED` — w ścieżce API zwrotów integracyjnych rekord tworzony jest ze statusem **`SUCCEEDED`** po udanej transakcji księgowej. |
| **`RefundCoveredBy`** | `PLATFORM` (koszt z portfela platformy) \| `CONNECTED_ACCOUNT` (tylko subkonta z splitu charge) \| `SPLIT` (podział proporcjonalny do ledgera `mkt:{chargeId}:credit:platform` vs `credit:{subkonto}`). |
| **Model `Refund`** | Powiązanie z `MarketplaceCharge` (`chargeId`), kwota w groszach (`amount`), `currency`, `coveredBy`, `reason`, `initiatedBy`, opcjonalnie `metadata`, unikalny `idempotencyKey` (Redis + DB). |
| **Ledger zwrotu** | Typy `TransactionType`: **`REFUND_DEBIT`** (źródła), **`REFUND_CREDIT`** (kredyt płatnika charge). `referenceId`: `ref:{refundId}:credit`, `ref:{refundId}:debit:platform`, `ref:{refundId}:debit:ca:{connectedAccountId}`. |
| **Spory / chargeback (`Dispute`)** | Powiązanie z `MarketplaceCharge`; `pspDisputeId` unikalny (PSP); `status` m.in. `RECEIVED` → … → `WON` \| `LOST` \| `ACCEPTED`; `reason` (`DisputeReason`); kwota sporna `amount` (grosze); `evidenceDueBy` — termin dowodów od PSP. Ledger: **`DISPUTE_HOLD`** przy otwarciu (`disp:{id}:hold`), przy wygranej **`DISPUTE_HOLD_RELEASE`** (`disp:{id}:hold_release`), przy przegranej / akceptacji dodatkowo **`DISPUTE_DEBIT_FINAL`** (`disp:{id}:final`) po zwolnieniu holdu w tej samej transakcji — saldo końcowe jak po holdzie. Webhooki B2B: `dispute.created` / `dispute.won` / `dispute.lost` / `dispute.accepted`. Wewnętrzny endpoint PSP: **`POST /internal/webhooks/psp-dispute`** (HMAC jak wpłata). Alerty: co **1 h** proces sprawdza spory `RECEIVED` \| `UNDER_REVIEW` z `evidenceDueBy` w ciągu **48 h** i loguje ostrzeżenie (`contextLogger`, pola m.in. `disputeId`, `hoursLeft`). |

**Konfiguracja:** portfel platformy do zwrotów `PLATFORM`/`SPLIT` — zmienna **`APEXPAY_PLATFORM_USER_ID`** (preferowana) lub **`SAFE_TAXI_PLATFORM_USER_ID`** (fallback); użytkownik musi mieć wiersz `Wallet`.

## RabbitMQ

Instancja produkcyjna **wymaga działającego brokera AMQP** dla settlement (outbox zdarzeń) oraz — przy ustawionym `RABBITMQ_URL` — natychmiastowej kolejki webhooków B2B. W `docker-compose.prod.yml` serwis **`rabbitmq`** (profil `selfhosted`) używa obrazu z panelem zarządzania; panel nasłuchuje na hoście tylko pod **`127.0.0.1:15672`**, aby nie wystawiać go publicznie bez świadomej konfiguracji (np. Traefik z ograniczeniem dostępu).

**Rotacja hasła do brokera:** ustaw nowe `RABBITMQ_DEFAULT_PASS` i zaktualizuj `RABBITMQ_URL` (z URL-encoding znaków specjalnych w haśle), następnie zrestartuj API — szczegóły w [SECRETS_ROTATION.md](./SECRETS_ROTATION.md) (sekcja RabbitMQ).

Szablon zmiennych: **`/.env.prod.example`** oraz **`/ops/.env.prod.template`** (skrót połączeń).
