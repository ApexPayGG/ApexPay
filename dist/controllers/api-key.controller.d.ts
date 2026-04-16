import type { Request, Response } from "express";
import { ApiKeyService } from "../services/api-key.service.js";
export declare class ApiKeyController {
    private readonly apiKeyService;
    constructor(apiKeyService: ApiKeyService);
    /** Lista kluczy zalogowanego użytkownika — JWT. */
    list(req: Request, res: Response): Promise<void>;
    /** Tworzenie klucza — wymaga JWT (konto integratora). */
    create(req: Request, res: Response): Promise<void>;
    /** Usunięcie klucza — JWT; audyt API_KEY_DELETED. */
    deleteById(req: Request, res: Response): Promise<void>;
    /** Profil wyłącznie po kluczu API (middleware `apiKeyAuth`). */
    integrationsMe(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=api-key.controller.d.ts.map