import cookieParser from "cookie-parser";
import cors from "cors";
import express, {} from "express";
import helmet from "helmet";
import { createServer } from "http";
import { AuthController } from "./controllers/auth.controller.js";
import { MatchController } from "./controllers/match.controller.js";
import { MatchResolveV1Controller } from "./controllers/match-resolve-v1.controller.js";
import { TournamentController } from "./controllers/tournament.controller.js";
import { PspDepositWebhookController } from "./controllers/psp-deposit-webhook.controller.js";
import { WalletController } from "./controllers/wallet.controller.js";
import { createHmacSignatureMiddleware, parseApiSecretKeysFromEnv, } from "./middleware/hmac-signature.middleware.js";
import { createIdempotencyResolveMiddleware } from "./middleware/idempotency-resolve.middleware.js";
import { createResolveRateLimitMiddleware } from "./middleware/resolve-rate-limit.middleware.js";
import { authMiddleware } from "./middlewares/auth.middleware.js";
import { AuthService } from "./services/auth.service.js";
import { ClearingService } from "./services/clearing.service.js";
import { MatchSettlementService } from "./services/match-settlement.service.js";
import { PspDepositWebhookService } from "./services/psp-deposit-webhook.service.js";
import { WalletService } from "./services/wallet.service.js";
import { WebSocketService } from "./services/websocket.service.js";
export function createApp(options) {
    const app = express();
    app.use(helmet());
    app.use(cors({
        origin: true,
        credentials: true,
    }));
    app.use(express.json({
        verify: (req, _res, buf) => {
            req.rawBody = buf;
        },
    }));
    app.use(cookieParser());
    const authService = new AuthService(options.prisma);
    const authController = new AuthController(authService);
    const walletService = new WalletService(options.prisma);
    const walletController = new WalletController(walletService);
    const pspDepositWebhookService = new PspDepositWebhookService(walletService);
    const pspDepositWebhookController = new PspDepositWebhookController(pspDepositWebhookService, () => process.env.PSP_DEPOSIT_WEBHOOK_SECRET?.trim() || undefined);
    const tournamentController = new TournamentController();
    const httpServer = createServer(app);
    const wsService = options.wsService ?? new WebSocketService(httpServer);
    const clearingService = new ClearingService(options.prisma);
    const matchController = new MatchController(options.prisma, clearingService, wsService);
    const settlementService = options.matchSettlementService ??
        new MatchSettlementService(options.prisma);
    const matchResolveV1 = new MatchResolveV1Controller(settlementService, wsService);
    const idempotencyResolve = createIdempotencyResolveMiddleware(options.redis);
    const hmacSignature = createHmacSignatureMiddleware({
        secretKeys: parseApiSecretKeysFromEnv(),
    });
    const resolveRateLimit = createResolveRateLimitMiddleware(options.redis);
    app.post("/internal/webhooks/psp-deposit", (req, res) => {
        void pspDepositWebhookController.handle(req, res);
    });
    app.post("/api/auth/register", (req, res) => {
        void authController.register(req, res);
    });
    app.post("/api/auth/login", (req, res) => {
        void authController.login(req, res);
    });
    app.post("/api/wallet/deposit", authMiddleware, (req, res) => {
        void walletController.deposit(req, res);
    });
    app.post("/api/wallet/charge", authMiddleware, (req, res) => {
        void walletController.chargeEntryFee(req, res);
    });
    app.post("/api/tournaments", authMiddleware, (req, res) => {
        void tournamentController.createTournament(req, res);
    });
    app.post("/api/tournaments/:id/join", authMiddleware, (req, res) => {
        void tournamentController.joinTournament(req, res);
    });
    app.post("/api/tournaments/:id/cancel", authMiddleware, (req, res) => {
        void tournamentController.cancelAndRefund(req, res);
    });
    app.post("/api/matches/:id/report", authMiddleware, (req, res) => {
        void matchController.reportResult(req, res);
    });
    app.post("/api/matches/:id/resolve", authMiddleware, (req, res) => {
        void matchController.resolveDispute(req, res);
    });
    app.post("/api/v1/matches/:id/resolve", hmacSignature, authMiddleware, resolveRateLimit, idempotencyResolve, (req, res) => {
        void matchResolveV1.resolve(req, res);
    });
    app.use((err, _req, res, _next) => {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    });
    return { app, httpServer, wsService };
}
//# sourceMappingURL=create-app.js.map