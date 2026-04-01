/**
 * npm install bcrypt && npm install -D @types/bcrypt
 *
 * Serwis rejestracji: hash hasła (bcrypt ≥12 rund), atomowe utworzenie User + Wallet (Prisma $transaction).
 * Nie loguj haseł ani tokenów.
 */
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Prisma, UserRole } from "@prisma/client";
/** Minimalna liczba rund bcrypt (Security First). */
export const BCRYPT_ROUNDS = 12;
/** Stały hash do `bcrypt.compare` przy nieistniejącym użytkowniku — wyrównanie czasu odpowiedzi (timing attack). */
export const DUMMY_HASH = "$2b$12$ThisIsADummyHashForTimingAttack12345";
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_BYTES = 72;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Trim + małe litery (lokalna część i domena) — jedna ścieżka normalizacji przed walidacją i zapisem. */
export function normalizeEmailInput(raw) {
    return raw.trim().toLowerCase();
}
export class EmailAlreadyRegisteredError extends Error {
    constructor() {
        super("Email already registered");
        this.name = "EmailAlreadyRegisteredError";
    }
}
export class InvalidCredentialsError extends Error {
    constructor() {
        super("Invalid credentials");
        this.name = "InvalidCredentialsError";
    }
}
export class AuthValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "AuthValidationError";
    }
}
function getJwtSecret() {
    return process.env.JWT_SECRET || "dev-secret";
}
export class AuthService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async loginUser(email, password) {
        const normalizedEmail = normalizeEmailInput(email);
        const row = await this.prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: {
                id: true,
                email: true,
                role: true,
                passwordHash: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        if (row === null) {
            await bcrypt.compare(password, DUMMY_HASH);
            throw new InvalidCredentialsError();
        }
        const passwordOk = await bcrypt.compare(password, row.passwordHash);
        if (!passwordOk) {
            throw new InvalidCredentialsError();
        }
        const token = jwt.sign({ userId: row.id, email: row.email, role: row.role }, getJwtSecret(), { expiresIn: "24h" });
        return {
            token,
            user: {
                id: row.id,
                email: row.email,
                role: row.role,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
            },
        };
    }
    /** Profil użytkownika po zweryfikowanym `userId` z JWT (np. GET /me). */
    async getUserProfile(userId) {
        return this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                role: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    }
    async registerUser(email, password, roleInput) {
        const normalizedEmail = this.assertValidEmail(email);
        this.assertValidPassword(password);
        const role = this.resolveRegistrationRole(roleInput);
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        try {
            return await this.prisma.$transaction(async (tx) => {
                const user = await tx.user.create({
                    data: {
                        email: normalizedEmail,
                        passwordHash,
                        role,
                    },
                    select: {
                        id: true,
                        email: true,
                        role: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                });
                await tx.wallet.create({
                    data: {
                        userId: user.id,
                        balance: 0n,
                    },
                });
                return user;
            });
        }
        catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
                throw new EmailAlreadyRegisteredError();
            }
            throw err;
        }
    }
    assertValidEmail(raw) {
        const normalized = normalizeEmailInput(raw);
        if (normalized.length === 0) {
            throw new AuthValidationError("Email is required");
        }
        if (!EMAIL_PATTERN.test(normalized)) {
            throw new AuthValidationError("Invalid email format");
        }
        return normalized;
    }
    assertValidPassword(password) {
        if (password.length < MIN_PASSWORD_LENGTH) {
            throw new AuthValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
        }
        if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
            throw new AuthValidationError("Password exceeds maximum length for hashing");
        }
    }
    /** Publiczna rejestracja: domyślnie PLAYER; tylko wartości z enum UserRole. */
    resolveRegistrationRole(raw) {
        if (raw === undefined || raw === null || raw === "") {
            return UserRole.PLAYER;
        }
        if (raw === UserRole.PLAYER) {
            return UserRole.PLAYER;
        }
        if (raw === UserRole.ADMIN) {
            throw new AuthValidationError("Publiczna rejestracja z rolą ADMIN jest zabroniona.");
        }
        throw new AuthValidationError("Invalid role");
    }
}
//# sourceMappingURL=auth.service.js.map