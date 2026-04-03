# ApexPay — Etap 1+2+3 (Cloud & Security)

Ten dokument mapuje wdrozenie infrastruktury na 3 etapy, zgodnie z architektura fintech/gaming.

## Etap 1 — Konteneryzacja API + WEB

1. Build i publikacja obrazow:
   - API: `Dockerfile`
   - WEB: `Dockerfile.web` — **`VITE_API_URL`** (zmienna repozytorium GitHub, build-arg w deploy):
     - **Puste** — front woła względne `/api/...` na tym samym hoście co strona; wymaga działającego proxy w obrazie web (`deploy/nginx/web.conf`: `location ^~ /api/` → backend). To domyślny układ z `docker-compose.prod.yml` (Traefik → `web` → wewnętrznie `api`).
     - **`https://twoje-api`** (np. `https://api.apexpay.pl`) — bezpośrednie wywołania API z przeglądarki; na serwisie API ustaw **`CORS_ORIGIN`** na origin frontu (np. `https://apexpay.pl`).
2. Uruchamianie przez `docker-compose.prod.yml`:
   - `traefik` (TLS/LE)
   - `api-migrator` + `api` (dwa routery HTTP: `API_DOMAIN` oraz **`APP_DOMAIN` + `PathPrefix(/api)`** — logowanie z frontu bez HTML zamiast JSON)
   - `web` (Nginx, statyczny frontend)
3. Komenda:

```bash
docker compose -f docker-compose.prod.yml --profile selfhosted --env-file .env.prod up -d
```

## Etap 2 — Zarzadzane DB/Cache

`docker-compose.prod.yml` ma profile:

- `selfhosted` dla `postgres`, `redis`, `rabbitmq`
- bez profilu uruchamia tylko edge + app (`traefik`, `api`, `web`)

W trybie managed ustaw:

- `DATABASE_URL` do RDS/Cloud SQL
- `REDIS_URL` do ElastiCache/MemoryStore
- `RABBITMQ_URL` do zarzadzanego brokera lub self-hosted

Komenda managed:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

## Etap 3 — WAF, DDoS, hardening

1. App-level:
   - `TRUST_PROXY=1` (prawidlowy klient IP za reverse proxy/WAF)
   - rate-limit env:
     - `AUTH_RATE_*`
     - `ADMIN_FUND_RATE_*`
2. Edge-level (Traefik):
   - middleware rate-limit (`TRAEFIK_API_RATE_AVERAGE`, `TRAEFIK_API_RATE_BURST`)
   - security headers na routerze web
3. Cloudflare/AWS WAF:
   - ustaw domeny `APP_DOMAIN` i `API_DOMAIN`
   - dodaj reguly WAF dla:
     - `POST /api/v1/auth/login`
     - `POST /api/v1/wallet/fund`
   - threshold wg ruchu (start: 10-20 req/min/IP dla endpointow wrazliwych)

## Weryfikacja po wdrozeniu

1. `GET /health` => 200
2. `GET /health/ready` => 200
3. logowanie dziala przez `APP_DOMAIN`
4. API za `API_DOMAIN` zwraca poprawne 401/429 przy testach bez tokena/floodzie
5. CI `Test` + `Secrets Scan` zielone przed merge
