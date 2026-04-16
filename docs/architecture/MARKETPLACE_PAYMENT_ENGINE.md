# ApexPay — silnik płatności marketplace (wizja: Stripe Connect–class)

**Pierwszy klient produktowy:** SAFE TAXI (ride-hailing).  
**Cel:** pay-in od pasażera, **split** (platforma + kierowca), pay-out na banki, zgodność regulacyjna, API dla integratorów.

Ten dokument **mapuje wymagania modułów 1–5** na stan repozytorium, **decyzje obowiązkowe** (np. PCI) oraz **proponowane fazy** wdrożenia. Szczegóły transakcyjnego rdzenia (outbox, HMAC, idempotencja) są spójne z [ADR-001](./ADR-001-transaction-engine.md).

---

## Stan obecny w kodzie (punkt wyjścia)

| Obszar | Co jest |
|--------|---------|
| Ledger wewnętrzny | `Wallet`, `Transaction`, transakcje Prisma z izolacją `Serializable` tam, gdzie potrzeba (np. turnieje, SAFE TAXI settle) |
| SAFE TAXI (MVP) | `SafeTaxiRide`, `POST /api/v1/safe-taxi/rides`, `.../settle`, podział prowizji vs kierowca, konto platformy przez `SAFE_TAXI_PLATFORM_USER_ID` |
| Zdarzenia asynchroniczne | `OutboxEvent` + RabbitMQ + poller (`SKIP LOCKED`) — wzorzec pod **webhooki wychodzące** |
| Pay-in zewnętrzny (częściowo) | `POST /internal/webhooks/psp-deposit` (HMAC) — model „środki wpłynęły z PSP”, nie pełny vault kart |
| Auth API | JWT użytkownika końcowego; **brak** jeszcze modelu **Publishable / Secret Key** per integrator (marketplace) |

---

## MODUŁ 1 — Pay-in i tokenizacja (bez PCI w SAFE TAXI)

**Wymóg:** SAFE TAXI **nie** przechowuje PANów kart; zwracany jest `payment_method_token`.

**Decyzja architektoniczna (krytyczna):**  
**Nie budujemy własnego „vaultu” na pełne dane kart w Postgresie.** Pełna obsługa kart + SCA/3DS wymaga **licencjonowanego dostawcy** (Stripe, Adyen, Przelewy24, inny acquirer / PSP z tokenizacją i hosted fields / SDK).

| Dostarczane przez ApexPay | Dostarczane przez PSP |
|----------------------------|------------------------|
| Endpointy **serwerowe** po tokenie (`payment_method_id` od PSP) | Zbieranie danych karty w **iframe/SDK** PSP, **SCA**, token PM |
| Powiązanie `User` ↔ `externalCustomerId` / `paymentMethodId` (referencje, nie PAN) | PCI DSS Level 1 po stronie PSP |
| Idempotencja charge, webhook potwierdzenia | 3DS, retry, chargeback flow |

**API docelowe (szkic):** `POST /api/v1/payment-methods` (attach po tokenie z klienta), `POST /api/v1/charges` z `idempotency-key` — do zdefiniowania w kolejnej iteracji po wyborze PSP.

---

## MODUŁ 2 — Core ledger i split (Silnik rozliczeń)

**Wymóg:** subkonta (platforma + connected), routing regułami, **ACID**.

**Stan:** Wewnętrzny model to **jedna baza + wiele portfeli (`Wallet` per `User`)**. To jest poprawny **pierwszy krok** przed pełnym modelem „Connected Account” jak u Stripe.

**Kierunek rozwoju:**

1. **Encja `Merchant` / `ConnectedAccount`** (lub rozszerzenie `User` o typ dostawcy) z `status`: `pending_verification` | `active` | `restricted`.
2. **Żądanie charge z routingiem** — np. `{ amount, currency, splits: [{ accountId, amount|percent }] }` walidowane serwerowo; **jedna transakcja DB** z aktualizacją wielu sald + wpisy `Transaction` + ewentualnie outbox.
3. **Spójność:** kontynuacja wzorca z [ADR-001](./ADR-001-transaction-engine.md): transakcje Prisma, przy wysokim ryzyku konfliktów — `SELECT … FOR UPDATE` na wierszach portfeli (obecnie częściowo przez `Serializable` + obsługa `P2034`).

Obecny **SAFE TAXI `settle`** jest **uproszczonym split-em** (pasażer → platforma + kierowca); należy go **scalić koncepcyjnie** z przyszłym generycznym `/charge` z routingiem.

---

## MODUŁ 3 — Onboarding i compliance (KYC / AML)

**Wymóg:** `/accounts/create`, weryfikacja tożsamości, statusy subkont.

**Podejście:**  
- **Nie implementujemy „KYC w czystym SQL”.** Typowo: integracja z dostawcą (Onfido, Sumsub, Stripe Identity, lokalny partner) + przechowywanie **referencji** i statusu w ApexPay.
- API: `POST /v1/accounts` (tworzenie rekordu + workflow KYC), `GET /v1/accounts/:id` (status), webhooki od dostawcy KYC → aktualizacja `restricted` / `active`.

---

## MODUŁ 4 — Pay-out (wypłaty na bank)

**Wymóg:** środki wirtualne na subkoncie → **paczki przelewów** (Elixir/SEPA), harmonogramy.

**Podejście:**

1. **Osobny proces** (worker/cron) czytający salda do wypłaty, tworzący **`PayoutBatch`** + rekordy `PayoutItem` (audyt).
2. Integracja z **bankiem / agregatem płatności masowych** (API banku, partner B2B) — poza samym REST ApexPay; w bazie **nigdy** pełne numery kont w plaintext bez szyfrowania i polityk retencji.
3. Harmonogram: `cron` + konfiguracja per merchant lub globalna.

---

## MODUŁ 5 — Developer API i webhooks

**Wymóg:** klucze **Publishable / Secret**, webhooks (`payment_intent.succeeded`, `payout.failed`, `account.verified`).

**Stan częściowy:** wzorzec **Outbox → broker** już istnieje; należy dodać:

- **Tabela `WebhookEndpoint`** (URL, secret HMAC, typy zdarzeń) per aplikacja kliencka.
- **Publisher** po zapisie biznesowym: generowanie zdarzeń `payment_intent.succeeded` itd., dostarczanie z retry i podpisem (jak [PSP webhook](../API.md) po stronie odbiorcy).
- **Auth:** `Authorization: Bearer sk_live_…` lub nagłówek `X-Api-Key` — **osobny** od JWT użytkownika końcowego.

---

## Stos technologiczny (zgodnie z założeniami)

| Element | Użycie |
|---------|--------|
| PostgreSQL | Źródło prawdy sald i audytu; transakcje ACID |
| Redis | Rate limiting, idempotencja (już używane) |
| RabbitMQ | Kolejka zdarzeń / outbox (już używane) |
| TypeScript (strict) | Wymuszane w repo dla warstwy finansowej |

---

## Proponowane fazy (priorytety)

| Faza | Zakres |
|------|--------|
| **F0** (zrobione częściowo) | Wewnętrzny ledger, SAFE TAXI settle, outbox |
| **F1** | Wybór PSP; pay-in przez token PM; charge + webhook potwierdzający wpływ na `Wallet` |
| **F2** | Uogólniony **charge + split** API + model ConnectedAccount |
| **F3** | KYC (dostawca zewnętrzny) + statusy kont |
| **F4** | Payout batch + webhooks dla integratora (SAFE TAXI ↔ Supabase) |

---

## Dwie ścieżki splitu (Krok 1 — spójność modelu)

**SAFE TAXI** i **Marketplace (ConnectedAccount)** rozwiązują ten sam problem biznesowy (*jeden debit → wiele kredytów*), ale w innym kontekście danych:

| Ścieżka | Kiedy | Encja biznesowa | Idempotencja ledger |
|---------|--------|-----------------|----------------------|
| **SAFE TAXI `settleRide`** | Rozliczenie konkretnego przejazdu (`SafeTaxiRide`), prowizja z env | `SafeTaxiRide` + status `SETTLED` | Pierwszy wpis: `referenceId = stx:{rideId}:passenger` (unikalny w `Transaction`) |
| **Marketplace `chargeSplit`** | Dowolny podział na subkonta `ACTIVE` (sandbox / uogólniony split) | `MarketplaceCharge` + `ConnectedAccount` | Opcjonalnie `MarketplaceCharge.idempotencyKey`; wpisy `mkt:{chargeId}:debit`, `mkt:{chargeId}:credit:{connectedAccountId}` |

**Konwencje `referenceId` (reconciliacja):**

- `stx:{rideId}:passenger` — debit pasażera (`SAFE_TAXI_PASSENGER_CHARGE`)
- `stx:{rideId}:driver` — kredyt kierowcy (`SAFE_TAXI_DRIVER_PAYOUT`)
- `stx:{rideId}:platform` — prowizja platformy (`SAFE_TAXI_PLATFORM_FEE`)
- `mkt:{chargeUuid}:debit` — debit płatnika (`MARKETPLACE_PAYER_DEBIT`)
- `mkt:{chargeUuid}:credit:{connectedAccountId}` — kredyt odbiorcy (`MARKETPLACE_CONNECTED_CREDIT`)

Sumy: dla przejazdu `fareCents = |passenger| = driver + platform` (wg `splitSafeTaxiFare`). Dla marketplace: suma kredytów = `amountCents` z `MarketplaceCharge`.

**API admina:** `GET .../admin/transactions?referenceIdPrefix=stx:` lub `...Prefix=mkt:` — lista wpisów ledger pod export / kontrolę (JSON; eksport CSV robi klient lub skrypt).

**Kierunek późniejszej unifikacji:** wspólna logika *walidacji splitu i aktualizacji portfeli* może trafić do jednej warstwy serwisowej; do tego czasu **nie** mieszać encji (`SafeTaxiRide` nie jest `MarketplaceCharge`).

---

## Ryzyka i granice

- **PCI:** dotyk kart wyłącznie przez PSP + tokeny; dokumentacja operacyjna i DPIA pod RODO/PSD2 przy pełnym launchu.
- **Licencje:** działalność płatnicza w UE może wymagać statusu **instytucji płatniczej / partnera EMI** — warstwa prawna poza kodem.

---

*Dokument roboczy; wersjonowany w repozytorium razem z kodem.*
