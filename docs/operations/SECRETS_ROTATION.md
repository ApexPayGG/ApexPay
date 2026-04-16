# Rotacja sekretów (ApexPay)

## Kiedy rotować natychmiast

- Podejrzenie wycieku **JWT_SECRET**, **DATABASE_URL**, kluczy webhooków, **SSH**, tokenów **GHCR**.
- Były w repozytorium / zrzucie ekranu / czacie **tokeny JWT** użytkowników (wymuś ponowne logowanie przez nowy `JWT_SECRET`).

## JWT_SECRET

1. Wygeneruj nowy długi losowy ciąg (min. 32 znaki).
2. Ustaw w środowisku produkcyjnym (`.env.prod` / sekrety hosta / Vault).
3. Zrestartuj proces **API** (nowy sekret unieważnia stare tokeny).
4. Poinformuj użytkowników o konieczności ponownego logowania.

## DATABASE_URL

1. Przy rotacji hasła użytkownika DB: zaktualizuj connection string, zrestartuj API i migrator.
2. Rozważ krótki maintenance window lub rolling restart, jeśli pool ma otwarte połączenia.

## Redis / RabbitMQ / inne

Postępuj według dostawcy: nowe hasło → aktualizacja zmiennych środowiskowych → restart workerów i API.

### RabbitMQ (hasło brokera)

1. Wygeneruj silne hasło (np. `openssl rand -base64 32` albo menedżer haseł).
2. W **self-hosted** Docker: ustaw **`RABBITMQ_DEFAULT_PASS`** w `.env.prod` (oraz zaktualizuj **`RABBITMQ_URL`** — ten sam login/hasło; przy znakach specjalnych URL-encode jak w komentarzu w `.env.prod.example`).
3. Zmień hasło w działającym brokerze (`rabbitmqctl change_password …`) albo — przy świeżej instancji — zatrzymaj stack, usuń wolumen `rabbitmq_data` tylko jeśli akceptujesz utratę kolejek, uruchom ponownie z nowymi zmiennymi.
4. Zrestartuj **`api`** (i ewentualne worker’y), żeby odświeżyły połączenia AMQP.

## Checklist po rotacji

- [ ] `GET /health` → 200  
- [ ] `GET /health/ready` → 200 (DB + Redis)  
- [ ] Logowanie i chroniony endpoint (np. `GET /api/v1/auth/me`) działają  
- [ ] CI na `main` przechodzi przed kolejnym deployem  

## Dobre praktyki

- **Nie** commituj `.env`, `test.http` z tokenami (w repo jest `test.http.example`).
- Używaj **`.env.example`** jako dokumentacji nazw zmiennych, nie wartości.
