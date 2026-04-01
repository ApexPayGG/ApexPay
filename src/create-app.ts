import cookieParser from "cookie-parser";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import type { Redis } from "ioredis";
import { createServer, type Server as HttpServer } from "http";
import type { PrismaClient } from "@prisma/client";
import { UserRole } from "@prisma/client";
import { AuthController } from "./controllers/auth.controller.js";
import { MatchController } from "./controllers/match.controller.js";
import { MatchResolveV1Controller } from "./controllers/match-resolve-v1.controller.js";
import { TournamentController } from "./controllers/tournament.controller.js";
import { PspDepositWebhookController } from "./controllers/psp-deposit-webhook.controller.js";
import { WalletController } from "./controllers/wallet.controller.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import {
  createHmacSignatureMiddleware,
  parseApiSecretKeysFromEnv,
} from "./middleware/hmac-signature.middleware.js";
import { createIdempotencyResolveMiddleware } from "./middleware/idempotency-resolve.middleware.js";
import { createResolveRateLimitMiddleware } from "./middleware/resolve-rate-limit.middleware.js";
import { authMiddleware, requireRole } from "./middlewares/auth.middleware.js";
import { AuthService } from "./services/auth.service.js";
import { ClearingService } from "./services/clearing.service.js";
import { MatchSettlementService } from "./services/match-settlement.service.js";
import { PspDepositWebhookService } from "./services/psp-deposit-webhook.service.js";
import { WalletService } from "./services/wallet.service.js";
import { WebSocketService } from "./services/websocket.service.js";

export type CreateAppOptions = {
  prisma: PrismaClient;
  redis: Redis;
  wsService?: WebSocketService;
  /** Override for tests; defaults to `new MatchSettlementService(prisma)`. */
  matchSettlementService?: Pick<MatchSettlementService, "settleDisputedMatch">;
};

export function createApp(options: CreateAppOptions): {
  app: ReturnType<typeof express>;
  httpServer: HttpServer;
  wsService: WebSocketService;
} {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as Request).rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());

  const authService = new AuthService(options.prisma);
  const authController = new AuthController(authService);
  const walletService = new WalletService(options.prisma);
  const walletController = new WalletController(walletService);
  const pspDepositWebhookService = new PspDepositWebhookService(walletService);
  const pspDepositWebhookController = new PspDepositWebhookController(
    pspDepositWebhookService,
    () => process.env.PSP_DEPOSIT_WEBHOOK_SECRET?.trim() || undefined,
  );
  const tournamentController = new TournamentController();

  const httpServer = createServer(app);
  const wsService =
    options.wsService ?? new WebSocketService(httpServer);

  const clearingService = new ClearingService(options.prisma);
  const matchController = new MatchController(
    options.prisma,
    clearingService,
    wsService,
  );

  const settlementService =
    options.matchSettlementService ??
    new MatchSettlementService(options.prisma);
  const matchResolveV1 = new MatchResolveV1Controller(
    settlementService,
    wsService,
  );

  const idempotencyResolve = createIdempotencyResolveMiddleware(options.redis);
  const hmacSignature = createHmacSignatureMiddleware({
    secretKeys: parseApiSecretKeysFromEnv(),
  });
  const resolveRateLimit = createResolveRateLimitMiddleware(options.redis);

  app.post("/internal/webhooks/psp-deposit", (req, res) => {
    void pspDepositWebhookController.handle(req, res);
  });

  const authRouter = createAuthRouter(authController);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/auth", authRouter);

  app.post("/api/wallet/deposit", authMiddleware, (req, res) => {
    void walletController.deposit(req as never, res as never);
  });

  app.post("/api/wallet/charge", authMiddleware, (req, res) => {
    void walletController.chargeEntryFee(req as never, res as never);
  });

  app.get("/api/wallet/me", authMiddleware, (req, res) => {
    void walletController.getMyWallet(req, res);
  });
  app.get("/api/v1/wallet/me", authMiddleware, (req, res) => {
    void walletController.getMyWallet(req, res);
  });

  app.post(
    "/api/wallet/fund",
    authMiddleware,
    requireRole([UserRole.ADMIN]),
    (req, res) => {
      void walletController.fundWallet(req, res);
    },
  );
  app.post(
    "/api/v1/wallet/fund",
    authMiddleware,
    requireRole([UserRole.ADMIN]),
    (req, res) => {
      void walletController.fundWallet(req, res);
    },
  );

  app.post("/api/tournaments", authMiddleware, (req, res) => {
    void tournamentController.createTournament(req as never, res as never);
  });

  app.post("/api/tournaments/:id/join", authMiddleware, (req, res) => {
    void tournamentController.joinTournament(req as never, res as never);
  });

  app.post("/api/tournaments/:id/cancel", authMiddleware, (req, res) => {
    void tournamentController.cancelAndRefund(req as never, res as never);
  });

  app.post("/api/matches/:id/report", authMiddleware, (req, res) => {
    void matchController.reportResult(req as never, res as never);
  });

  app.post("/api/matches/:id/resolve", authMiddleware, (req, res) => {
    void matchController.resolveDispute(req as never, res as never);
  });

  app.post(
    "/api/v1/matches/:id/resolve",
    hmacSignature,
    authMiddleware,
    resolveRateLimit,
    idempotencyResolve,
    (req, res) => {
      void matchResolveV1.resolve(req as never, res as never);
    },
  );

  app.use(
    (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      console.error(err);
      res.status(500).json({ error: "Internal Server Error" });
    },
  );

  return { app, httpServer, wsService };
}
