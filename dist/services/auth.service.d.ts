/**
 * npm install bcrypt && npm install -D @types/bcrypt
 *
 * Serwis rejestracji: hash hasła (bcrypt ≥12 rund), atomowe utworzenie User + Wallet (Prisma $transaction).
 * Nie loguj haseł ani tokenów.
 */
import { UserRole, type PrismaClient } from "@prisma/client";
/** Minimalna liczba rund bcrypt (Security First). */
export declare const BCRYPT_ROUNDS = 12;
/** Stały hash do `bcrypt.compare` przy nieistniejącym użytkowniku — wyrównanie czasu odpowiedzi (timing attack). */
export declare const DUMMY_HASH = "$2b$12$ThisIsADummyHashForTimingAttack12345";
/** Trim + małe litery (lokalna część i domena) — jedna ścieżka normalizacji przed walidacją i zapisem. */
export declare function normalizeEmailInput(raw: string): string;
export type RegisteredUser = {
    id: string;
    email: string;
    role: UserRole;
    createdAt: Date;
    updatedAt: Date;
};
export type LoginUserResult = {
    token: string;
    user: RegisteredUser;
};
export declare class EmailAlreadyRegisteredError extends Error {
    constructor();
}
export declare class InvalidCredentialsError extends Error {
    constructor();
}
export declare class AuthValidationError extends Error {
    constructor(message: string);
}
export declare class AuthService {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    loginUser(email: string, password: string): Promise<LoginUserResult>;
    /** Profil użytkownika po zweryfikowanym `userId` z JWT (np. GET /me). */
    getUserProfile(userId: string): Promise<RegisteredUser | null>;
    registerUser(email: string, password: string, roleInput?: unknown): Promise<RegisteredUser>;
    private assertValidEmail;
    private assertValidPassword;
    /** Publiczna rejestracja: domyślnie PLAYER; tylko wartości z enum UserRole. */
    private resolveRegistrationRole;
}
//# sourceMappingURL=auth.service.d.ts.map