# ApexPay — load testing (k6)

Scenariusze symulują ruch platformy taxi / marketplace: płatność pasażera (initiate + ITN Autopay), równoległe charge’y B2B, burza webhooków ITN oraz mieszany ruch z regułami antyfraud.

## Wymagania

- [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) **≥ v0.47** (transpilacja TypeScript / bundling).
- Działające API ApexPay + PostgreSQL + Redis (lokalnie lub staging).
- Dla ITN: na serwerze API ustawione **`AUTOPAY_SERVICE_ID`** i **`AUTOPAY_SHARED_KEY`** — te same wartości musisz przekazać do k6 (inaczej hash ITN będzie odrzucony).

## Instalacja k6

### Windows

- Instalator MSI / Chocolatey / `winget` — zobacz [dokumentację k6](https://grafana.com/docs/k6/latest/set-up/install-k6/).
- Skrypt `run.sh` uruchom z **Git Bash** albo WSL (`bash load-tests/run.sh`).

### macOS

```bash
brew install k6
```

### Linux (np. CI)

```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

## Zmienne środowiskowe

| Zmienna | Opis |
|--------|------|
| `BASE_URL` | URL API (domyślnie `http://localhost:3000`). |
| `AUTOPAY_SERVICE_ID` | Zgodny z API. |
| `AUTOPAY_SHARED_KEY` | Zgodny z API (sekret — nie commituj). |
| `LOAD_ADMIN_EMAIL` | Konto **ADMIN** (wymagane dla scenariuszy: charge’y, fraud). |
| `LOAD_ADMIN_PASSWORD` | Hasło ADMIN. |

**Konto ADMIN:** np. `npm run smoke:local:admin` z `DATABASE_URL` — tworzy/aktualizuje admina w DB (patrz `src/scripts/smoke-local.ts`).

## Limity rate limiting (ważne)

Domyślne limity API mogą **zepsuć** scenariusze przy dużej liczbie VU z jednego adresu IP:

- `RATE_LIMIT_PAYMENTS_MAX` — `/api/v1/payments/initiate`
- `RATE_LIMIT_API_GENERAL_MAX` — ogólny limit `/api/v1/*`
- `RATE_LIMIT_WEBHOOKS_MAX` — `/internal/webhooks/*`

Dla **webhook-storm** (200 VU × wiele ITN) ustaw np. `RATE_LIMIT_WEBHOOKS_MAX=10000` lub dodaj IP klienta do `RATE_LIMIT_TRUSTED_IPS` na środowisku testowym.

## Uruchomienie

Z katalogu głównego repozytorium (po `npm install`, jeśli dodajesz tylko typy):

```bash
# pojedyncze scenariusze (JSON w load-tests/results/)
npm run load:payment
npm run load:charges
npm run load:webhooks
npm run load:fraud

# wszystkie po kolei (bash)
bash load-tests/run.sh
```

Bez npm:

```bash
cd load-tests
k6 run -e BASE_URL=http://localhost:3000 -e AUTOPAY_SERVICE_ID=... -e AUTOPAY_SHARED_KEY=... scenarios/payment-flow.ts
```

## Interpretacja wyników

- **Podsumowanie w terminalu:** `http_req_duration` (avg, p90, p95), `http_req_failed`, `checks`, `iterations`.
- **Plik JSON** (`--out json=...`): seria próbek — do analizy w Grafana / własnych skryptów.
- **Thresholds:** jeśli k6 kończy się kodem **99**, przynajmniej jeden próg nie został spełniony — szczegóły w sekcji `thresholds` w outputcie.

### Gdy threshold nie przechodzi

1. Sprawdź, czy błąd to **429** (rate limit) — zwiększ limity lub rozłóż ruch (więcej IP).
2. Sprawdź **connectivity** do DB/Redis i obciążenie CPU/RAM na hoście API.
3. Porównaj **p95/p99** z baseline — regresja często wynika z N+1 zapytań, locków, braku indeksów.
4. Scenariusz **concurrent-charges** celowo oczekuje **429** przy szczycie VU (wspólne IP) — metric `saw_429` musi być > 0.

## Wymagania sprzętowe (minimalne orientacyjnie)

- **API + DB + Redis na jednym hoście:** dla scenariuszy 100–500 VU z jednej maszyny k6 — **4 vCPU**, **8 GB RAM** na serwerze aplikacji to dolna granica; przy pełnym stacku produkcyjnym rozważ osobne hosty DB/Redis.
- **Maszyna k6:** lekka, ale z stabilnym CPU — liczba VU nie jest równoważna liczbie realnych użytkowników (iteracja jest uproszczona).

## Struktura

- `config.ts` — URL, progi, odczyt ENV.
- `lib/autopay-itn.ts` — hash BM + XML/base64 ITN.
- `lib/client.ts` — rejestracja, logowanie, charge, ITN, bootstrap integratora (ADMIN).
- `scenarios/*.ts` — scenariusze k6.
