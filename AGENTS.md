# ApexPay — instrukcja dla agenta / AI w Cursorze

**Główna zasada:** wszystko, co da się zrobić w Cursorze, rób **w Cursorze** — edycja plików, zapis, terminal (`npm test`, `npm run typecheck`, `git`), a nie same instrukcje dla użytkownika.

1. **Implementacja** — zmiany w repo, bez zbędnych plików poza zakresem zadania.
2. **Weryfikacja** — po zmianach w API: `npm test`; po zmianach we frontendzie: `npm run typecheck --prefix frontend` (i lint, jeśli potrzeba). Nie zgłaszaj sukcesu bez dowodu z uruchomionych komend (o ile środowisko na to pozwala).
3. **Git** — na prośbę: commit + push z czytelnym opisem.
4. **Bezpieczeństwo** — bez sekretów w kodzie i commitach; bez prośby o hasła użytkownika.
5. **VPS / SSH** — zasady w `.cursor/rules/vps-deploy.mdc`; skrypty `npm run ops:vps-*` gdy działa klucz SSH.

Szczegóły techniczne reguły Cursor: `.cursor/rules/execute-in-cursor.mdc` (`alwaysApply: true` + opis **USE WHEN**).

**Włączenie w Cursorze (UI):** *Cursor Settings* → *Rules* → przy regule z projektu włącz **globus** („Always apply” / dołączanie do kontekstu), jeśli widzisz taką opcję. Pliki `.mdc` edytujesz normalnie jako tekst dzięki `.vscode/settings.json` (`*.mdc` → default editor).
