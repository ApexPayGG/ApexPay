import path from "node:path";
import { fileURLToPath } from "node:url";
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
import { AdminController } from "./controllers/admin.controller.js";
import { AuthController } from "./controllers/auth.controller.js";
import { MatchController } from "./controllers/match.controller.js";
import { MatchResolveV1Controller } from "./controllers/match-resolve-v1.controller.js";
import { SafeTaxiController } from "./controllers/safe-taxi.controller.js";
import { TournamentController } from "./controllers/tournament.controller.js";
import { PspDepositWebhookController } from "./controllers/psp-deposit-webhook.controller.js";
import { WalletController } from "./controllers/wallet.controller.js";
import { createAdminRouter } from "./routes/admin.routes.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import { legacyApiDeprecationMiddleware } from "./middleware/legacy-deprecation.middleware.js";
import {
  clientIpForRateLimit,
  createSlidingWindowRateLimit,
} from "./middleware/redis-sliding-window-rate-limit.js";
import { sendApiError, ApiErrorCode } from "./lib/api-error.js";
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
import { TournamentBracketService } from "./services/tournament-bracket.service.js";
import { PspDepositWebhookService } from "./services/psp-deposit-webhook.service.js";
import { SafeTaxiService } from "./services/safe-taxi.service.js";
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
  const trustProxy = process.env.TRUST_PROXY?.trim();
  if (trustProxy !== undefined && trustProxy.length > 0) {
    app.set("trust proxy", trustProxy);
  }

  app.use(helmet());
  const corsOriginEnv = process.env.CORS_ORIGIN?.trim();
  const corsAllowedOrigins =
    corsOriginEnv === undefined || corsOriginEnv.length === 0
      ? null
      : corsOriginEnv.split(",").map((origin) => origin.trim()).filter(Boolean);
  app.use(
    cors({
      origin: corsAllowedOrigins ?? true,
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

  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
  app.use(express.static(publicDir));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });
  app.get("/health/ready", async (_req, res) => {
    try {
      await options.prisma.$queryRaw`SELECT 1`;
      const pong = await options.redis.ping();
      if (pong !== "PONG") {
        throw new Error("Redis ping failed");
      }
      res.status(200).json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "not_ready", code: "SERVICE_UNAVAILABLE" });
    }
  });

  app.use(legacyApiDeprecationMiddleware);

  const authService = new AuthService(options.prisma);
  const authController = new AuthController(authService);
  const walletService = new WalletService(options.prisma);
  const walletController = new WalletController(walletService);
  const adminController = new AdminController(walletService);
  const pspDepositWebhookService = new PspDepositWebhookService(walletService);
  const pspDepositWebhookController = new PspDepositWebhookController(
    pspDepositWebhookService,
    () => process.env.PSP_DEPOSIT_WEBHOOK_SECRET?.trim() || undefined,
  );
  const tournamentController = new TournamentController();
  const safeTaxiService = new SafeTaxiService(options.prisma);
  const safeTaxiController = new SafeTaxiController(safeTaxiService);

  const httpServer = createServer(app);
  const wsService =
    options.wsService ?? new WebSocketService(httpServer);

  const bracketService = new TournamentBracketService(options.prisma);
  const clearingService = new ClearingService(options.prisma);
  const matchController = new MatchController(
    options.prisma,
    clearingService,
    wsService,
    bracketService,
  );

  const settlementService =
    options.matchSettlementService ??
    new MatchSettlementService(options.prisma, bracketService);
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

  const authRateWindowMs = Number(process.env.AUTH_RATE_WINDOW_MS ?? "60000");
  const authRateMaxRequests = Number(process.env.AUTH_RATE_MAX_REQUESTS ?? "25");
  const authPostRateLimit = createSlidingWindowRateLimit(options.redis, {
    windowMs: Number.isFinite(authRateWindowMs) ? authRateWindowMs : 60_000,
    maxRequests: Number.isFinite(authRateMaxRequests) ? authRateMaxRequests : 25,
    keyPrefix: "ratelimit:sliding:v1:auth:ip",
    keyFromRequest: clientIpForRateLimit,
  });
  const adminFundRateWindowMs = Number(process.env.ADMIN_FUND_RATE_WINDOW_MS ?? "60000");
  const adminFundRateMaxRequests = Number(process.env.ADMIN_FUND_RATE_MAX_REQUESTS ?? "20");
  const adminFundRateLimit = createSlidingWindowRateLimit(options.redis, {
    windowMs: Number.isFinite(adminFundRateWindowMs) ? adminFundRateWindowMs : 60_000,
    maxRequests: Number.isFinite(adminFundRateMaxRequests)
      ? adminFundRateMaxRequests
      : 20,
    keyPrefix: "ratelimit:sliding:v1:wallet-fund:ip",
    keyFromRequest: clientIpForRateLimit,
  });
  const authRouter = createAuthRouter(authController, {
    postRateLimit: authPostRateLimit,
  });
  app.use("/api/v1/auth", authRouter);
  app.use("/api/auth", authRouter);

  const adminRouter = createAdminRouter(adminController);
  app.use(
    "/api/v1/admin",
    authMiddleware,
    requireRole([UserRole.ADMIN]),
    adminRouter,
  );
  app.use(
    "/api/admin",
    authMiddleware,
    requireRole([UserRole.ADMIN]),
    adminRouter,
  );

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
    adminFundRateLimit,
    authMiddleware,
    requireRole([UserRole.ADMIN]),
    (req, res) => {
      void walletController.fundWallet(req, res);
    },
  );
  app.post(
    "/api/v1/wallet/fund",
    adminFundRateLimit,
    authMiddleware,
    requireRole([UserRole.ADMIN]),
    (req, res) => {
      void walletController.fundWallet(req, res);
    },
  );

  app.post("/api/v1/wallet/transfer", authMiddleware, (req, res) => {
    void walletController.transfer(req, res);
  });
  app.post("/api/wallet/transfer", authMiddleware, (req, res) => {
    void walletController.transfer(req, res);
  });

  app.post("/api/v1/safe-taxi/rides", authMiddleware, (req, res) => {
    void safeTaxiController.createRide(req, res);
  });
  app.post("/api/v1/safe-taxi/rides/:id/settle", authMiddleware, (req, res) => {
    void safeTaxiController.settleRide(req, res);
  });

  app.get("/api/tournaments", authMiddleware, (req, res) => {
    void tournamentController.listTournaments(req as never, res as never);
  });

  app.get("/api/tournaments/:id", authMiddleware, (req, res) => {
    void tournamentController.getTournament(req as never, res as never);
  });

  app.post("/api/tournaments", authMiddleware, (req, res) => {
    void tournamentController.createTournament(req as never, res as never);
  });

  app.post("/api/tournaments/:id/join", authMiddleware, (req, res) => {
    void tournamentController.joinTournament(req as never, res as never);
  });

  app.post("/api/tournaments/:id/start", authMiddleware, (req, res) => {
    void tournamentController.startTournament(req as never, res as never);
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

  /** Zbudowany React (Vite): jeden port z API — `APEXPAY_WEB_UI_DIR=./frontend/dist npm start` */
  const webUiDir = process.env.APEXPAY_WEB_UI_DIR?.trim();
  if (webUiDir !== undefined && webUiDir.length > 0) {
    const abs = path.resolve(process.cwd(), webUiDir);
    app.use(
      express.static(abs, {
        index: false,
        fallthrough: true,
      }),
    );
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      const p = req.path;
      if (
        p.startsWith("/api") ||
        p.startsWith("/health") ||
        p.startsWith("/metrics") ||
        p.startsWith("/internal") ||
        p.startsWith("/socket.io")
      ) {
        next();
        return;
      }
      res.sendFile(path.join(abs, "index.html"), (err) => {
        if (err) next(err);
      });
    });
  }

  app.use(
    (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      console.error(err);
      const parseErr = err as { type?: unknown; status?: unknown; statusCode?: unknown };
      if (
        parseErr.type === "entity.parse.failed" ||
        parseErr.status === 400 ||
        parseErr.statusCode === 400
      ) {
        sendApiError(
          res,
          400,
          ApiErrorCode.BAD_REQUEST,
          "Invalid JSON body",
        );
        return;
      }
      sendApiError(
        res,
        500,
        ApiErrorCode.INTERNAL,
        "Internal Server Error",
      );
    },
  );

  return { app, httpServer, wsService };
}
