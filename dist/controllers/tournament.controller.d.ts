import type { Request, Response } from "express";
export declare class TournamentController {
    createTournament(req: Request, res: Response): Promise<void>;
    joinTournament(req: Request, res: Response): Promise<void>;
    /**
     * Start turnieju (Etap 2): REGISTRATION → IN_PROGRESS, generacja meczów 1. rundy.
     *
     * - Wyłącznie **organizator** (`organizerId` z turnieju = `user.id` z JWT).
     * - Wymaga statusu **REGISTRATION** oraz braku istniejących meczów (idempotencja względem „gołego” turnieju).
     * - Co najmniej **2** uczestników; **parzysta** liczba (MVP: N/2 meczów PENDING, pary wg `joinedAt` rosnąco).
     * - Każdy mecz dostaje **playerAId** / **playerBId** (kolejność par = kolejność zapisów), **roundNumber** = 1.
     * - **awardsTournamentPrize**: true tylko gdy w turnieju jest jeden mecz (finał od razu); przy większej drabince wypłata tylko z finału.
     * - Po sukcesie `POST .../join` zwraca błąd (rejestracja zamknięta).
     */
    startTournament(req: Request, res: Response): Promise<void>;
    cancelAndRefund(req: Request, res: Response): Promise<void>;
    listTournaments(req: Request, res: Response): Promise<void>;
    getTournament(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=tournament.controller.d.ts.map