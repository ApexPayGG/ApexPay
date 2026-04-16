# ApexPay API

Backend płatności i portfeli (Node.js, Express, Prisma) oraz powiązane aplikacje frontendowe w monorepozytorium.

## Dokumentacja dla integratorów

Statyczna witryna w stylu Stripe Docs (HTML/CSS/vanilla JS) znajduje się w katalogu **[`docs-site/`](./docs-site/)**. Zawiera m.in. quickstart, uwierzytelnianie (`x-api-key`), płatności Autopay, marketplace charges, wypłaty, zwroty, webhooki HMAC i kody błędów.

- Lokalny podgląd i wdrożenie (Vercel / GitHub Pages): [`docs-site/README.md`](./docs-site/README.md)
- Pełna lista endpointów i konwencji: [`docs/API.md`](./docs/API.md)

## Rozwój

- API: `npm install`, `npm run dev:api`, `npm test`, `npm run typecheck:api`
- Panel (`frontend/`): `npm run dev:web` w katalogu głównym lub zgodnie ze skryptami w `package.json`

Szczegóły operacji i wdrożeń VPS opisane są w `.cursor/rules` oraz w `docs/operations/`.
