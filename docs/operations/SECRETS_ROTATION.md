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

## Checklist po rotacji

- [ ] `GET /health` → 200  
- [ ] `GET /health/ready` → 200 (DB + Redis)  
- [ ] Logowanie i chroniony endpoint (np. `GET /api/v1/auth/me`) działają  
- [ ] CI na `main` przechodzi przed kolejnym deployem  

## Dobre praktyki

- **Nie** commituj `.env`, `test.http` z tokenami (w repo jest `test.http.example`).
- Używaj **`.env.example`** jako dokumentacji nazw zmiennych, nie wartości.
