# ADR 001: Implementacja niezawodnego silnika rozliczeniowego i wzorca Transactional Outbox

## Status

**Zaakceptowany (Accepted)**

## Data

2026-03-28

## Kontekst

System obsługuje rozliczenia finansowe związane ze sporami meczów oraz powiązanymi operacjami na portfelach. W takim obszarze występują następujące problemy biznesowe i techniczne:

- **Ryzyko podwójnego rozliczenia (double settlement / double-spending logiczny)** — wielokrotne przetworzenie tego samego żądania rozliczenia może prowadzić do niespójnego stanu księgowego lub wielokrotnej dystrybucji środków względem intencji biznesowej.
- **Niestabilność sieci i zaufania między systemami (S2S)** — integracje serwer-do-serwera wymagają uwierzytelnienia treści żądania oraz ograniczenia nadużyć; brak twardych limitów naraża API na przeciążenie i ataki polegające na powtarzaniu żądań.
- **Potrzeba audytowalności i śledzenia skutków finansowych** — decyzje rozliczeniowe powinny być powiązane z trwałym zapisem w bazie oraz z możliwością późniejszego wyjaśnienia „co zostało zapisane” przed komunikacją na zewnątrz.
- **Wysoka dostępność i odporność na awarie pośredników** — publikacja zdarzeń do brokera wiadomości nie może być „punktem utraty prawdy”: awaria RabbitMQ lub sieci nie powinna powodować utraty informacji o rozliczeniu już zatwierdzonym w bazie.
- **Operacyjna obserwowalność i powtarzalne wdrożenia** — zespół musi mierzyć opóźnienia i błędy oraz wdrażać aplikację w sposób przewidywalny (kontenery, Kubernetes).

Powyższe wymusza spójny zestaw decyzji architektonicznych oparty na mechanizmach faktycznie zaimplementowanych w kodzie (middleware, serwisy Redis/Prisma, outbox, RabbitMQ, metryki, Docker, manifesty K8s).

## Decyzja

Przyjmujemy architekturę opartą na pięciu filarach, zgodnej z obecną implementacją w repozytorium.

### 1. Ochrona wejścia (HMAC + limitowanie żądań w Redis)

- **HMAC-SHA256 nad surowym ciałem żądania** — dla wybranego endpointu rozliczeniowego (`POST /api/v1/matches/:id/resolve`) weryfikowany jest nagłówek (domyślnie `x-signature`) jako HMAC-SHA256 całego payloadu względem `API_SECRET_KEY`. Surowe body jest zachowywane przez `express.json({ verify })` jako `rawBody`, aby podpis był zgodny z bajtami „z sieci”.
- **Limit częstotliwości (sliding window w Redis)** — osobny middleware ogranicza liczbę żądań do powyższego endpointu na użytkownika (identyfikowanego po JWT) do **5 żądań na 60 s** na użytkownika, przy użyciu skryptu Lua w Redis (atomowość), ze statusem HTTP 429 przy przekroczeniu limitu.
- **Kolejność middleware** — dla ścieżki v1: weryfikacja HMAC (jeśli skonfigurowany sekret), następnie autoryzacja JWT, limiter, idempotencja.

### 2. Idempotencja oraz blokady pesymistyczne (Redis + Prisma)

- **Idempotencja rozliczenia v1** — wymagany nagłówek `Idempotency-Key`; stan idempotencji jest utrzymywany w Redis (`SHA-256` z `matchId` i klucza). Nabycie blokady atomowe skryptem Lua; zakończenie sukcesem zapisuje odpowiedź w Redis z użyciem `MULTI`/`EXEC` (zgodnie z implementacją middleware).
- **Rozliczenie sporu w bazie** — `MatchSettlementService` wykonuje transakcję bazy z izolacją `Serializable`, z blokadą pesymistyczną **`SELECT ... FOR UPDATE`** na wierszu meczu oraz obsługą ponowień przy błędzie deadlock (`P2034`), zgodnie z kodem serwisu.
- **Pomiar czasu** — czas trwania transakcji rozliczenia jest rejestrowany histogramem Prometheus (`match_resolution_duration_seconds`).

### 3. Wzorzec Transactional Outbox (zapis zdarzenia w tej samej transakcji co logika finansowa)

- W ramach tej samej transakcji co aktualizacja stanu meczu i rozliczenia portfeli tworzony jest rekord **`OutboxEvent`** (np. zdarzenie typu `FUNDS_SETTLED` z payloadem JSON). Zapewnia to, że „zgoda na rozliczenie” w bazie i „zdarzenie do wysłania” powstają jednocześnie lub wcale (ACID w obrębie transakcji Prisma).

### 4. Gwarancja dostarczenia (Publisher Confirms, poller SKIP LOCKED, konsument z DLQ)

- **Publikacja** — przy skonfigurowanym `RABBITMQ_URL` używany jest `RabbitMqConnectionManager` z kanałem potwierdzeń (`confirmChannel`), publikacja z `ack` brokera oraz reconnect z wycofaniem wykładniczym; emitowane jest zdarzenie `reconnected` dla odbudowy konsumenta.
- **OutboxPollerService** — okresowo pobiera partiami wiersze `PENDING` zapytaniem **`FOR UPDATE SKIP LOCKED`**, oznacza je jako `PROCESSING`, publikuje do brokera po `eventType`; przy błędzie publikacji inkrementowany jest licznik błędów (`message_broker_publish_errors_total`) i stosowana jest logika ponowień / statusu `FAILED` zgodnie z kodem.
- **SettlementEventConsumerService** — osobny konsument na kolejce powiązanej z exchange `apexpay.events` i routingiem `FUNDS_SETTLED`, z kolejką DLQ skonfigurowaną argumentami kolejki głównej; `prefetch`, `noAck: false`, `ack`/`nack` (przy błędzie przetwarzania `nack` z `requeue=false` kieruje do DLQ). Konsument nasłuchuje `reconnected` managera w celu odbudowy kanału bez duplikacji listenerów.
- **OutboxCleanupService** — osobny komponent cykliczny w procesie aplikacji (szczegóły zakresu w kodzie serwisu).

### 5. Obserwowalność i wdrożenie (Prometheus, Docker, Kubernetes)

- **Metryki** — rejestr `prom-client` z domyślnymi metrykami Node; eksport HTTP `GET /metrics` (bez JWT, rejestrowany na `app` w `server.ts`); dodatkowo metryki domenowe: rozmiar batcha outboxa (`outbox_pending_events_total`), histogram czasu rozliczenia, licznik błędów publikacji.
- **Zdrowie procesu** — `GET /health` (liveness) oraz `GET /health/ready` (readiness: zapytanie `SELECT 1` + `redis.ping()`).
- **Docker** — multi-stage build na `node:20-alpine`, etap produkcyjny z `npm ci --omit=dev`, kopiowanie wygenerowanego klienta Prisma z etapu buildera, użytkownik nie-root (`USER node`), `CMD ["node", "dist/server.js"]`.
- **Kubernetes** — manifesty w `k8s/`: `Deployment` z init containerem uruchamiającym `npx prisma migrate deploy` z tym samym obrazem i sekretem co aplikacja, oraz `Service` typu `ClusterIP`; sondy HTTP na `/health` i `/health/ready`, `readOnlyRootFilesystem` z `emptyDir` na `/tmp`.

## Konsekwencje

### Pozytywne

- Spójność finansowa w bazie względem intencji rozliczenia dzięki transakcji z `FOR UPDATE` i idempotencją po stronie Redis.
- Brak „zgubienia” zdarzenia po rozliczeniu: zapis outboxa w tej samej transakcji co logika portfela.
- Możliwość ponownego dostarczenia zdarzeń po awarii brokera (poller + stany wierszy outboxa) oraz śledzenie błędów publikacji metrykami.
- Odporność na błędy sieci przy publikacji (potwierdzenia, reconnect) i izolacja problemów konsumenta (DLQ).
- Obserwowalność operacyjna (metryki, endpointy zdrowia) oraz wdrożenia z kontrolą migracji schematu (init container / K8s).

### Negatywne i trade-offy

- **Złożoność infrastruktury** — wymagany jest Redis, PostgreSQL oraz (dla pełnej ścieżki) RabbitMQ; brak URL-a RabbitMQ w konfiguracji powoduje użycie brokera „no-op” (bez realnej publikacji), co zmniejsza koszt dev, ale nie odzwierciedla produkcji.
- **Utrzymanie RabbitMQ** — eksploatacja kolejek, DLQ, monitorowanie i aktualizacje brokera to stały koszt operacyjny.
- **Migracje Prisma** — muszą być stosowane świadomie (Job/init, kolejność z wdrożeniem binariów); w środowisku z wieloma replikami równoległe uruchomienia `migrate deploy` wymagają dyscypliny (np. init container per Pod — jak w `k8s/api-deployment.yaml` — z ryzykiem równoległych startów; w praktyce migracje są zazwyczaj idempotentne przy jednym schemacie).
- **Koszt latencji i złożoności kodu** — dodatkowe warstwy (HMAC, limit, idempotencja, outbox, konsument) zwiększają czas wdrożenia zmiany i testowania.
- **Readiness** — obecna gotowość nie weryfikuje pełnego połączenia z RabbitMQ w sondzie HTTP (Redis + DB), co przy bardzo wolnej inicjalizacji brokera może krótkotrwale kierować ruch zanim połączenie będzie stabilne; jest to świadomy uproszczenie względem kosztu sondy.

## Uwagi końcowe

Niniejszy dokument opisuje wyłącznie mechanizmy obecne w kodzie i powiązanych plikach konfiguracyjnych w repozytorium w momencie sporządzenia ADR. Nie stanowi pełnej specyfikacji produktowej ani listy przyszłych rozszerzeń.
