# ApexPay — dokumentacja dla integratorów (statyczna)

Statyczna witryna HTML/CSS/JS (bez frameworków), styl zbliżony do Stripe Docs. Zawiera przewodnik po API v1: uwierzytelnianie, płatności Autopay, charges, wypłaty, zwroty, webhooki i kody błędów.

## Podgląd lokalny

Z katalogu `docs-site/` uruchom dowolny serwer plików statycznych, np.:

```bash
cd docs-site
npx --yes serve -l 4173
```

Następnie otwórz w przeglądarce: `http://localhost:4173`.

Alternatywy: `python -m http.server 4173` (Python 3) lub rozszerzenie „Live Server” w edytorze.

## Wdrożenie na Vercel

1. Utwórz projekt Vercel i wskaż to repozytorium.
2. Ustaw **Root Directory** na `docs-site`.
3. **Framework Preset**: Other (brak builda) — `vercel.json` ustawia hosting statyczny z katalogu głównego projektu docs.

Domyślnie Vercel serwuje `index.html` dla ścieżki `/`.

## GitHub Pages

1. W ustawieniach repozytorium: **Pages** → **Build from branch** (folder `docs-site`) albo użyj workflow kopiującego `docs-site/` do gałęzi `gh-pages`.
2. Upewnij się, że ścieżki do `css/` i `js/` są względne (są — działają przy deploymencie w podkatalogu tylko jeśli strona jest w root domeny; dla Project Pages z podścieżką może być potrzebny base URL — wtedy rozważ osobne repo lub Vercel).

## Źródło prawdy API

Szczegółowe tabele endpointów: [`docs/API.md`](../docs/API.md) w repozytorium głównym.
