# ApexPay — pierwsza konfiguracja i produkcja (krok po kroku)

Ten dokument zbiera **konkretne linki** do dokumentacji vendorów oraz ścieżki w interfejsach (GitHub, Slack). Zamień `OWNER` i `REPO` na swoją organizację i nazwę repozytorium, np. `ghcr.io/moja-org/apexpay-api`.

---

## Spis treści

1. [Konto GitHub i repozytorium](#1-konto-github-i-repozytorium)
2. [Sekrety Actions (wdrożenie SSH + Slack)](#2-sekrety-github-actions)
3. [GitHub Container Registry (GHCR) i widoczność obrazu](#3-github-container-registry-ghcr)
4. [Pierwszy push na `main` i obserwacja workflow](#4-pierwszy-push-na-main)
5. [Serwer VPS — przygotowanie](#5-serwer-vps--przygotowanie)
6. [Pliki na serwerze (`/opt/apexpay-api`)](#6-pliki-na-serwerze-optapexpay-api)
7. [Zmienne w `.env.prod` (produkcja)](#7-zmienne-w-envprod-produkcja)
8. [Domena, DNS, Traefik, Let’s Encrypt](#8-domena-dns-traefik-lets-encrypt)
9. [Webhook Slack — tworzenie URL](#9-webhook-slack--tworzenie-url)
10. [Webhook wpłat PSP (`PSP_DEPOSIT_WEBHOOK_SECRET`)](#10-webhook-wpłat-psp)
11. [Weryfikacja lokalna (skrypt w repo)](#11-weryfikacja-lokalna-skrypt-w-repo)
12. [Czego nie da się „zrobić zdalnie” za Ciebie](#12-czego-nie-da-się-zrobić-zdalnie-za-ciebie)

---

## 1. Konto GitHub i repozytorium

| Cel | Link |
|-----|------|
| Tworzenie konta / logowanie | [https://github.com/signup](https://github.com/signup) |
| Nowe repozytorium | [https://github.com/new](https://github.com/new) |
| Dokumentacja Git (clone, push) | [https://docs.github.com/en/get-started/quickstart/set-up-git](https://docs.github.com/en/get-started/quickstart/set-up-git) |
| SSH keys do GitHub | [https://docs.github.com/en/authentication/connecting-to-github-with-ssh](https://docs.github.com/en/authentication/connecting-to-github-with-ssh) |

**Kroki:** utwórz repo (np. prywatne), dodaj remote `origin`, wypchnij kod na gałąź `main`.

---

## 2. Sekrety GitHub Actions

Dokumentacja oficjalna:  
[Using secrets in GitHub Actions](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions)

**Ścieżka w UI:** repozytorium → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

| Nazwa sekretu (dokładnie) | Zawartość | Do czego służy |
|---------------------------|-----------|----------------|
| `HOST` | Hostname lub IP serwera (np. `deploy.example.com` lub `203.0.113.10`) | Połączenie SSH z joba `deploy` |
| `USERNAME` | Użytkownik SSH na serwerze (np. `deploy`, `ubuntu`) | Logowanie SSH |
| `SSH_PRIVATE_KEY` | **Cały** klucz prywatny OpenSSH (wiele linii, od `-----BEGIN` do `-----END`) | Uwierzytelnianie SSH — wygeneruj parę ed25519 lokalnie, **publiczny** wrzuć na serwer w `~/.ssh/authorized_keys` |
| `SLACK_WEBHOOK_URL` | URL Incoming Webhook z Slacka (krok 9) | Job `notify` — powiadomienie po deployu |

**Uwaga:** `GITHUB_TOKEN` jest wstrzykiwany automatycznie przez GitHub do workflow — **nie** dodajesz go ręcznie w Secrets (chyba że kiedyś używasz własnego PAT w innym workflow).

**Generowanie klucza SSH (lokalnie, przykład):**

```bash
ssh-keygen -t ed25519 -C "github-actions-apexpay" -f ./gh_actions_deploy -N ""
```

- Plik **`gh_actions_deploy`** (bez `.pub`) → wklej jako wartość **`SSH_PRIVATE_KEY`**.
- Zawartość **`gh_actions_deploy.pub`** → jedna linia na serwerze w `~/.ssh/authorized_keys` użytkownika z **`USERNAME`**.

Dokumentacja: [Generating a new SSH key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent).

---

## 3. GitHub Container Registry (GHCR)

| Temat | Link |
|-------|------|
| Praca z GHCR (logowanie, nazewnictwo obrazów) | [Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry) |
| Uprawnienia pakietu (kto może `docker pull`) | [Configuring a package's access control and visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility) |

Workflow publikuje obraz pod adresem w formacie:

`ghcr.io/owner/repo/apexpay-api:latest`  
(`owner/repo` jest **małymi literami** — workflow to normalizuje.)

**Co sprawdzić po pierwszym udanym buildzie:**  
Repozytorium → **Packages** (po prawej stronie lub w organizacji) → pakiet `apexpay-api` → upewnij się, że serwer produkcyjny (token użyty przy `docker login` na serwerze) ma prawo **read** do tego pakietu. Dla `GITHUB_TOKEN` z tego samego repo zwykle działa bez dodatkowej konfiguracji przy pullu z tego repozytorium.

---

## 4. Pierwszy push na `main`

| Temat | Link |
|-------|------|
| O gałęziach | [About branches](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-workflow-with-pull-requests/about-branches) |
| Lista uruchomień Actions | `https://github.com/OWNER/REPO/actions` |

**Kroki:**

1. Upewnij się, że workflow jest w ścieżce `.github/workflows/deploy-production.yml` w repozytorium.
2. Wypchnij commit na **`main`** (merge PR lub bezpośredni push).
3. Otwórz **Actions** → workflow **Deploy production**.
4. Sprawdź joby: **Build & Push** → **Deploy** → **Notify**.

Jeśli **Deploy** pada na SSH: zweryfikuj `HOST`, `USERNAME`, `SSH_PRIVATE_KEY`, oraz na serwerze `sshd` i firewall (port 22).

---

## 5. Serwer VPS — przygotowanie

| Temat | Link |
|-------|------|
| Docker Engine (Linux) | [Install Docker Engine](https://docs.docker.com/engine/install/) |
| Docker Compose V2 | [Compose plugin](https://docs.docker.com/compose/install/linux/) |

**Minimalne wymagania:** Linux z Docker + Compose, otwarty **SSH (22)** do GitHub Actions, porty **80** i **443** na świat (Traefik + Let’s Encrypt).

Opcjonalnie: firewall tylko dla Twojego IP na SSH — wtedy GitHub Actions **nie** połączy się (runner ma zmienne IP). Typowe rozwiązania: [self-hosted runner](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners), VPN, lub SSH dostępny z internetu z autoryzacją kluczem.

---

## 6. Pliki na serwerze (`/opt/apexpay-api`)

Na serwerze (jako użytkownik z prawem do Dockera, często w grupie `docker`):

```bash
sudo mkdir -p /opt/apexpay-api
sudo chown "$USER:$USER" /opt/apexpay-api
```

Skopiuj tam z repozytorium m.in.:

- `docker-compose.prod.yml`
- `.env.prod` (utworzysz lokalnie i **nie** commitujesz z hasłami — tylko bezpieczny transfer, np. `scp`)

Przykład kopiowania z maszyny lokalnej:

```bash
scp docker-compose.prod.yml USER@HOST:/opt/apexpay-api/
scp .env.prod USER@HOST:/opt/apexpay-api/
```

---

## 7. Zmienne w `.env.prod` (produkcja)

W pliku używanym przez:

`docker compose -f docker-compose.prod.yml --env-file .env.prod ...`

muszą być m.in. (nazwy jak w `docker-compose.prod.yml`):

- `DATABASE_URL` — connection string do Postgres na serwerze (serwis `postgres` w sieci Compose).
- `JWT_SECRET` — długi losowy sekret (nie ten sam co dev).
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `REDIS_URL` — zwykle `redis://redis:6379` wewnątrz sieci Compose.
- `RABBITMQ_URL`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`
- `ACME_EMAIL` — email do Let’s Encrypt (Traefik).
- `API_DOMAIN` — FQDN API, np. `api.twojadomena.pl`
- `APP_DOMAIN` — FQDN frontendu, np. `apexpay.pl`
- `JWT_SECRET` (powtórzenie świadome — tylko jedna zmienna w pliku)
- **`APEXPAY_API_IMAGE`** — pełny adres obrazu z GHCR, np.  
  `ghcr.io/owner/repo/apexpay-api:latest`  
  (workflow deploy ustawia to samo w sesji shell — **musisz** mieć spójność z tym, co buduje CI; najprościej ustawić w `.env.prod` ten sam URL co w GHCR).
- **`APEXPAY_WEB_IMAGE`** — pełny adres obrazu frontendu z GHCR, np.  
  `ghcr.io/owner/repo/apexpay-web:latest`.

Dodatkowo dla API (sekcja `environment` serwisu `api` — jeśli rozszerzysz compose o `env_file` dla `api`, albo przez `environment` z interpolacji):

- **`PSP_DEPOSIT_WEBHOOK_SECRET`** — jeśli używasz webhooka wpłat (krok 10).

---

## 8. Domena, DNS, Traefik, Let’s Encrypt

| Temat | Link |
|-------|------|
| Let’s Encrypt | [https://letsencrypt.org/getting-started/](https://letsencrypt.org/getting-started/) |
| Traefik Docker | [Traefik & Docker](https://doc.traefik.io/traefik/getting-started/docker/) |

**DNS:** rekord **A** (lub **AAAA**) dla `api.twojadomena.pl` → publiczny IP serwera.

Po starcie stacku Traefik wystawia certyfikat TLS dla `${API_DOMAIN}` i `${APP_DOMAIN}` (wartości z `.env.prod`), o ile porty 80/443 są osiągalne z internetu.

---

## 9. Webhook Slack — tworzenie URL

| Temat | Link |
|-------|------|
| Incoming Webhooks (legacy app) | [https://api.slack.com/messaging/webhooks](https://api.slack.com/messaging/webhooks) |
| Tworzenie aplikacji / webhook w Slack API | [https://api.slack.com/apps](https://api.slack.com/apps) |

**Kroki (typowe):**

1. Wejdź na [https://api.slack.com/apps](https://api.slack.com/apps) → **Create New App** (From scratch).
2. Dodaj capability **Incoming Webhooks** → włącz → wybierz kanał.
3. Skopiuj **Webhook URL** → wklej jako **`SLACK_WEBHOOK_URL`** w GitHub Secrets (krok 2).

---

## 10. Webhook wpłat PSP

- Endpoint w API: **`POST /internal/webhooks/psp-deposit`**
- Nagłówek: **`x-apexpay-signature`** — HMAC-SHA256 (hex) **surowego** body JSON z sekretem **`PSP_DEPOSIT_WEBHOOK_SECRET`**.
- Zmienna środowiskowa na hoście z API: **`PSP_DEPOSIT_WEBHOOK_SECRET`** (ten sam sekret, którego używasz po stronie podpisującej żądanie).

Szczegóły payloadu i przykład `openssl` są w **`api-tests.http`** w repozytorium.

---

## 11. Weryfikacja lokalna (skrypt w repo)

Z poziomu katalogu projektu:

```bash
npm run ops:check-env
```

Opcjonalnie z plikiem produkcyjnym:

```bash
npm run ops:check-env -- --env-file=.env.prod
```

Skrypt sprawdza obecność kluczowych zmiennych (bez wyświetlania wartości sekretów).

---

## 12. Czego nie da się „zrobić zdalnie” za Ciebie

- **Zalogowanie się** na Twoje konto GitHub, Slack, dostawcę VPS — musisz Ty (lub zespół z dostępem).
- **Wklejenie sekretów** w GitHub / na serwer — tylko z Twojej przeglądarki lub bezpiecznego kanału.
- **Decyzje prawne** (regulamin, KYC, PSP) — poza repozytorium.

**Co jest zautomatyzowane w repo:** workflow **Deploy production** (build → GHCR → SSH → compose) oraz job **notify** (Slack). **Skrypt `ops:check-env`** pomaga nie zapomnieć o zmiennych przed uruchomieniem.

---

## Szybka ścieżka „checklista”

- [ ] Repo na GitHubie, kod na `main`
- [ ] Sekrety: `HOST`, `USERNAME`, `SSH_PRIVATE_KEY`, `SLACK_WEBHOOK_URL`
- [ ] Serwer: Docker, katalog `/opt/apexpay-api`, pliki compose + `.env.prod`
- [ ] DNS → IP serwera
- [ ] Pierwszy zielony run **Deploy production** na [Actions](https://github.com/OWNER/REPO/actions)
- [ ] `PSP_DEPOSIT_WEBHOOK_SECRET` jeśli używasz webhooka wpłat
- [ ] `npm run ops:check-env` lokalnie przed deployem
