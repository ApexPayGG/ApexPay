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
import { DisputeAdminController } from "./controllers/dispute-admin.controller.js";
import { FraudAdminController } from "./controllers/fraud-admin.controller.js";
import { WebhookDeadLetterAdminController } from "./controllers/webhook-dead-letter-admin.controller.js";
import { AdminAnalyticsController } from "./controllers/admin-analytics.controller.js";
import { PspDisputeWebhookController } from "./controllers/psp-dispute-webhook.controller.js";
import { AutopayItnWebhookController } from "./controllers/autopay-itn-webhook.controller.js";
import { AuthController } from "./controllers/auth.controller.js";
import { MatchController } from "./controllers/match.controller.js";
import { MatchResolveV1Controller } from "./controllers/match-resolve-v1.controller.js";
import { IntegrationsAccountController } from "./controllers/integrations-account.controller.js";
import { IntegrationsConfigController } from "./controllers/integrations-config.controller.js";
import { IntegrationsChargeController } from "./controllers/integrations-charge.controller.js";
import { IntegrationsPayoutController } from "./controllers/integrations-payout.controller.js";
import { IntegrationsRefundController } from "./controllers/integrations-refund.controller.js";
import { ApiKeyController } from "./controllers/api-key.controller.js";
import { PaymentMethodController } from "./controllers/payment-method.controller.js";
import { PaymentsController } from "./controllers/payments.controller.js";
import { MarketplaceController } from "./controllers/marketplace.controller.js";
import { SafeTaxiController } from "./controllers/safe-taxi.controller.js";
import { TournamentController } from "./controllers/tournament.controller.js";
import { PspDepositWebhookController } from "./controllers/psp-deposit-webhook.controller.js";
import { createPspDepositWebhookHmacMiddleware } from "./middleware/psp-deposit-hmac.middleware.js";
import { TradeController } from "./controllers/trade.controller.js";
import { WalletController } from "./controllers/wallet.controller.js";
import { createAdminRouter } from "./routes/admin.routes.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import { legacyApiDeprecationMiddleware } from "./middleware/legacy-deprecation.middleware.js";
import { sendApiError, ApiErrorCode } from "./lib/api-error.js";
import { contextLogger } from "./lib/logger.js";
import { createTraceMiddleware } from "./middleware/trace.middleware.js";
import { createRateLimiter } from "./lib/rate-limiter.js";
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
import { AutopayService } from "./services/autopay.service.js";
import { RideFinalizeService } from "./services/ride-finalize.service.js";
import { createApiKeyAuthMiddleware } from "./middleware/apiKeyAuthMiddleware.js";
import { createIntegratorHybridAuthMiddleware } from "./middleware/integrator-hybrid-auth.middleware.js";
import { PaymentMethodService } from "./services/payment-method.service.js";
import { ConnectedAccountService } from "./services/connected-account.service.js";
import { IntegratorConfigService } from "./services/integrator-config.service.js";
import { ApiKeyService } from "./services/api-key.service.js";
import { AuditLogService } from "./services/audit-log.service.js";
import { WebhookDeadLetterService } from "./services/webhook-dead-letter.service.js";
import { MarketplaceChargeService } from "./services/marketplace-charge.service.js";
import { PayoutService } from "./services/payout.service.js";
import { RefundService } from "./services/refund.service.js";
import { DisputeService } from "./services/dispute.service.js";
import { FraudDetectionService } from "./services/fraud-detection.service.js";
import { SafeTaxiService } from "./services/safe-taxi.service.js";
import { TradeService } from "./services/trade.service.js";
import { WalletService } from "./services/wallet.service.js";
import { WebSocketService } from "./services/websocket.service.js";

export type CreateAppOptions = {
  prisma: PrismaClient;
  redis: Redis;
  wsService?: WebSocketService;
  /** Override for tests; defaults to `new MatchSettlementService(prisma)`. */
  matchSettlementService?: Pick<MatchSettlementService, "settleDisputedMatch">;
  /**
   * Wywoływane po udanym commicie transakcji zapisującej WebhookOutbox (poza `$transaction`).
   * Np. publikacja `{ outboxId }` do RabbitMQ.
   */
  webhookPublish?: (outboxId: string) => Promise<void>;
};

export function createApp(options: CreateAppOptions): {
  app: ReturnType<typeof express>;
  httpServer: HttpServer;
  wsService: WebSocketService;
} {
  const app = express();
  app.use(createTraceMiddleware());
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
  const auditLogService = new AuditLogService(options.prisma);
  const fraudDetectionService = new FraudDetectionService(
    options.prisma,
    auditLogService,
  );
  const fraudAdminController = new FraudAdminController(fraudDetectionService);
  const disputeService = new DisputeService(
    options.prisma,
    options.redis,
    auditLogService,
    options.webhookPublish,
  );
  const disputeAdminController = new DisputeAdminController(disputeService);
  const pspDisputeWebhookController = new PspDisputeWebhookController(disputeService);
  const payoutService = new PayoutService(
    options.prisma,
    options.webhookPublish,
    auditLogService,
    fraudDetectionService,
  );
  const walletController = new WalletController(walletService);
  const tradeService = new TradeService(options.prisma);
  const tradeController = new TradeController(tradeService);
  const adminController = new AdminController(
    walletService,
    payoutService,
    auditLogService,
    options.prisma,
  );
  const webhookDeadLetterService = new WebhookDeadLetterService(
    options.prisma,
    auditLogService,
    options.webhookPublish,
  );
  const webhookDeadLetterAdminController = new WebhookDeadLetterAdminController(
    webhookDeadLetterService,
  );
  const adminAnalyticsController = new AdminAnalyticsController(options.prisma);
  const pspDepositWebhookService = new PspDepositWebhookService(
    walletService,
    options.redis,
  );
  const pspDepositWebhookController = new PspDepositWebhookController(
    pspDepositWebhookService,
  );
  const pspDepositWebhookHmac = createPspDepositWebhookHmacMiddleware(
    () => process.env.PSP_DEPOSIT_WEBHOOK_SECRET?.trim() || undefined,
  );
  const tournamentController = new TournamentController();
  const safeTaxiService = new SafeTaxiService(options.prisma);
  const safeTaxiController = new SafeTaxiController(safeTaxiService);
  const marketplaceChargeService = new MarketplaceChargeService(
    options.prisma,
    options.webhookPublish,
    auditLogService,
    fraudDetectionService,
  );
  const marketplaceController = new MarketplaceController(marketplaceChargeService);
  const paymentMethodService = new PaymentMethodService(options.prisma);
  const paymentMethodController = new PaymentMethodController(paymentMethodService);
  const autopayService = new AutopayService();
  const rideFinalizeService = new RideFinalizeService(options.prisma, auditLogService);
  const paymentsController = new PaymentsController(
    autopayService,
    options.prisma,
    rideFinalizeService,
    options.redis,
  );
  const autopayItnWebhookController = new AutopayItnWebhookController(
    autopayService,
    walletService,
    paymentMethodService,
    options.redis,
  );
  const apiKeyService = new ApiKeyService(options.prisma, auditLogService);
  const apiKeyAuthMiddleware = createApiKeyAuthMiddleware(apiKeyService);
  const integratorHybridAuthMiddleware =
    createIntegratorHybridAuthMiddleware(apiKeyService);
  const apiKeyController = new ApiKeyController(apiKeyService);
  const integrationsChargeController = new IntegrationsChargeController(
    marketplaceChargeService,
    options.redis,
  );
  const integrationsPayoutController = new IntegrationsPayoutController(
    payoutService,
    options.redis,
  );
  const refundService = new RefundService(
    options.prisma,
    auditLogService,
    options.webhookPublish,
  );
  const integrationsRefundController = new IntegrationsRefundController(
    refundService,
    options.redis,
  );
  const connectedAccountService = new ConnectedAccountService(
    options.prisma,
    auditLogService,
  );
  const integrationsAccountController = new IntegrationsAccountController(
    connectedAccountService,
  );
  const integratorConfigService = new IntegratorConfigService(options.prisma);
  const integrationsConfigController = new IntegrationsConfigController(
    integratorConfigService,
  );

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

  app.post(
    "/internal/webhooks/psp-deposit",
    pspDepositWebhookHmac,
    (req, res) => {
      void pspDepositWebhookController.handle(req, res);
    },
  );
  app.post(
    "/internal/webhooks/psp-dispute",
    pspDepositWebhookHmac,
    (req, res) => {
      void pspDisputeWebhookController.handle(req, res);
    },
  );
  app.post(
    "/internal/webhooks/autopay-itn",
    express.urlencoded({ extended: true }),
    (req, res) => {
      void autopayItnWebhookController.handle(req, res);
    },
  );

  const authRateMax = Number(process.env.RATE_LIMIT_AUTH_MAX ?? "10");
  const paymentsRateMax = Number(process.env.RATE_LIMIT_PAYMENTS_MAX ?? "30");
  const apiGeneralRateMax = Number(process.env.RATE_LIMIT_API_GENERAL_MAX ?? "100");
  const webhooksRateMax = Number(process.env.RATE_LIMIT_WEBHOOKS_MAX ?? "200");
  const adminRateMax = Number(process.env.RATE_LIMIT_ADMIN_MAX ?? "50");

  const authPostRateLimit = createRateLimiter(options.redis, {
    windowMs: 15 * 60_000,
    max: Number.isFinite(authRateMax) ? authRateMax : 10,
    keyPrefix: "auth",
    message: "Too many auth attempts. Try again later.",
  });
  const paymentsInitiateRateLimit = createRateLimiter(options.redis, {
    windowMs: 15 * 60_000,
    max: Number.isFinite(paymentsRateMax) ? paymentsRateMax : 30,
    keyPrefix: "payments_initiate",
    message: "Too many payment initiations. Try again later.",
  });
  const webhooksRateLimit = createRateLimiter(options.redis, {
    windowMs: 60_000,
    max: Number.isFinite(webhooksRateMax) ? webhooksRateMax : 200,
    keyPrefix: "internal_webhooks",
    message: "Webhook rate limit exceeded.",
  });
  const adminApiRateLimit = createRateLimiter(options.redis, {
    windowMs: 60_000,
    max: Number.isFinite(adminRateMax) ? adminRateMax : 50,
    keyPrefix: "admin_api",
    message: "Admin API rate limit exceeded.",
  });
  const apiGeneralRateLimit = createRateLimiter(options.redis, {
    windowMs: 60_000,
    max: Number.isFinite(apiGeneralRateMax) ? apiGeneralRateMax : 100,
    keyPrefix: "api_v1_general",
    message: "Too many API requests.",
  });

  // Global limiter dla /api/v1/* z wyłączeniem tras z dedykowanymi limitami.
  app.use("/api/v1", (req, res, next) => {
    if (req.path.startsWith("/auth/")) {
      next();
      return;
    }
    if (req.path === "/payments/initiate" && req.method === "POST") {
      next();
      return;
    }
    if (req.path.startsWith("/admin/")) {
      next();
      return;
    }
    apiGeneralRateLimit(req, res, next);
  });

  app.use("/internal/webhooks", (req, res, next) => {
    if (req.method !== "POST") {
      next();
      return;
    }
    webhooksRateLimit(req, res, next);
  });

  const authRouter = createAuthRouter(authController, {
    postRateLimit: authPostRateLimit,
  });
  app.use("/api/v1/auth", authRouter);
  app.use("/api/auth", authRouter);

  const adminRouter = createAdminRouter(
    adminController,
    disputeAdminController,
    fraudAdminController,
    webhookDeadLetterAdminController,
    adminAnalyticsController,
  );
  app.use(
    "/api/v1/admin",
    (req, res, next) => {
      if (req.method === "GET" || req.method === "POST") {
        adminApiRateLimit(req, res, next);
        return;
      }
      next();
    },
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

  app.post("/api/v1/wallet/transfer", authMiddleware, (req, res) => {
    void walletController.transfer(req, res);
  });
  app.post("/api/wallet/transfer", authMiddleware, (req, res) => {
    void walletController.transfer(req, res);
  });

  app.post("/api/v1/trades", authMiddleware, (req, res) => {
    void tradeController.create(req, res);
  });
  app.get("/api/v1/trades", authMiddleware, (req, res) => {
    void tradeController.listMine(req, res);
  });
  app.get("/api/v1/trades/:tradeId", (req, res) => {
    void tradeController.getById(req, res);
  });
  app.post("/api/v1/trades/:tradeId/pay", authMiddleware, (req, res) => {
    void tradeController.pay(req, res);
  });
  app.post("/api/v1/trades/:tradeId/confirm", authMiddleware, (req, res) => {
    void tradeController.confirm(req, res);
  });
  app.post("/api/v1/trades/:tradeId/cancel", authMiddleware, (req, res) => {
    void tradeController.cancel(req, res);
  });

  app.post("/api/v1/safe-taxi/rides", authMiddleware, (req, res) => {
    void safeTaxiController.createRide(req, res);
  });
  app.post("/api/v1/safe-taxi/rides/:id/settle", authMiddleware, (req, res) => {
    void safeTaxiController.settleRide(req, res);
  });

  app.post(
    "/api/v1/connected-accounts",
    authMiddleware,
    requireRole([UserRole.ADMIN]),
    (req, res) => {
      void marketplaceController.createConnectedAccount(req, res);
    },
  );
  app.patch(
    "/api/v1/connected-accounts/:id",
    authMiddleware,
    requireRole([UserRole.ADMIN]),
    (req, res) => {
      void marketplaceController.patchConnectedAccount(req, res);
    },
  );
  app.post(
    "/api/v1/charges",
    authMiddleware,
    requireRole([UserRole.ADMIN]),
    (req, res) => {
      void marketplaceController.createCharge(req, res);
    },
  );

  app.post("/api/v1/payment-methods", authMiddleware, (req, res) => {
    void paymentMethodController.create(req, res);
  });
  app.get("/api/v1/payment-methods", authMiddleware, (req, res) => {
    void paymentMethodController.list(req, res);
  });
  app.post("/api/v1/payments/initiate", paymentsInitiateRateLimit, authMiddleware, (req, res) => {
    void paymentsController.initiate(req, res);
  });
  app.post("/api/v1/payments/ride-finalize", apiKeyAuthMiddleware, (req, res) => {
    void paymentsController.rideFinalize(req, res);
  });

  app.get("/api/v1/api-keys", authMiddleware, (req, res) => {
    void apiKeyController.list(req, res);
  });
  app.post("/api/v1/api-keys", authMiddleware, (req, res) => {
    void apiKeyController.create(req, res);
  });
  app.delete("/api/v1/api-keys/:id", authMiddleware, (req, res) => {
    void apiKeyController.deleteById(req, res);
  });
  app.get(
    "/api/v1/integrations/me",
    apiKeyAuthMiddleware,
    (req, res) => {
      void apiKeyController.integrationsMe(req, res);
    },
  );
  app.get(
    "/api/v1/integrations/charges",
    integratorHybridAuthMiddleware,
    (req, res) => {
      void integrationsChargeController.listCharges(req, res);
    },
  );
  app.get(
    "/api/v1/integrations/charges/export",
    integratorHybridAuthMiddleware,
    (req, res) => {
      void integrationsChargeController.exportCharges(req, res);
    },
  );
  app.post(
    "/api/v1/integrations/charges",
    apiKeyAuthMiddleware,
    (req, res) => {
      void integrationsChargeController.createCharge(req, res);
    },
  );
  app.get(
    "/api/v1/integrations/charges/:chargeId/refunds",
    integratorHybridAuthMiddleware,
    (req, res) => {
      void integrationsRefundController.listForCharge(req, res);
    },
  );
  app.post(
    "/api/v1/integrations/charges/:chargeId/refunds",
    integratorHybridAuthMiddleware,
    (req, res) => {
      void integrationsRefundController.create(req, res);
    },
  );
  app.get(
    "/api/v1/integrations/payouts",
    integratorHybridAuthMiddleware,
    (req, res) => {
      void integrationsPayoutController.listPayouts(req, res);
    },
  );
  app.get(
    "/api/v1/integrations/payouts/export",
    integratorHybridAuthMiddleware,
    (req, res) => {
      void integrationsPayoutController.exportPayouts(req, res);
    },
  );
  app.post(
    "/api/v1/integrations/payouts",
    apiKeyAuthMiddleware,
    (req, res) => {
      void integrationsPayoutController.create(req, res);
    },
  );
  app.get(
    "/api/v1/integrations/accounts",
    integratorHybridAuthMiddleware,
    (req, res) => {
      void integrationsAccountController.list(req, res);
    },
  );
  app.post(
    "/api/v1/integrations/accounts",
    integratorHybridAuthMiddleware,
    (req, res) => {
      void integrationsAccountController.create(req, res);
    },
  );
  app.get(
    "/api/v1/integrations/config",
    integratorHybridAuthMiddleware,
    (req, res) => {
      void integrationsConfigController.get(req, res);
    },
  );
  app.put(
    "/api/v1/integrations/config",
    integratorHybridAuthMiddleware,
    (req, res) => {
      void integrationsConfigController.put(req, res);
    },
  );

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
      const log = contextLogger();
      if (err instanceof Error) {
        log.error(
          { err: { message: err.message, stack: err.stack, name: err.name } },
          "Unhandled error",
        );
      } else {
        log.error({ err }, "Unhandled error");
      }
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
