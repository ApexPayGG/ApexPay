import { UserRole } from "@prisma/client";
import { InsufficientFundsError, WalletNotFoundError, } from "../services/wallet.service.js";
import { RidePaymentMethod } from "@prisma/client";
import { DriverDebtLimitExceededError, SafeTaxiConfigError, SafeTaxiInvalidStateError, SafeTaxiRideNotFoundError, SafeTaxiService, } from "../services/safe-taxi.service.js";
export class SafeTaxiController {
    service;
    constructor(service) {
        this.service = service;
    }
    async createRide(req, res) {
        try {
            const passengerId = req.user?.id;
            if (typeof passengerId !== "string" || passengerId.length === 0) {
                res.status(401).json({ error: "Unauthorized" });
                return;
            }
            const body = req.body;
            const driverUserId = typeof body.driverUserId === "string" ? body.driverUserId.trim() : "";
            if (driverUserId.length === 0) {
                res.status(400).json({ error: "Wymagane pole: driverUserId (CUID kierowcy)." });
                return;
            }
            let paymentMethod = RidePaymentMethod.CARD;
            const rawPm = body.paymentMethod;
            if (rawPm === "CASH") {
                paymentMethod = RidePaymentMethod.CASH;
            }
            else if (rawPm !== undefined &&
                rawPm !== null &&
                rawPm !== "" &&
                rawPm !== "CARD") {
                res.status(400).json({
                    error: "paymentMethod musi być CARD lub CASH (opcjonalnie, domyślnie CARD).",
                });
                return;
            }
            const out = await this.service.createRide(passengerId, driverUserId, paymentMethod);
            res.status(201).json({
                status: "success",
                data: { rideId: out.rideId, paymentMethod },
            });
        }
        catch (err) {
            if (err instanceof WalletNotFoundError) {
                res.status(404).json({ error: "Brak portfela pasażera lub kierowcy." });
                return;
            }
            if (err instanceof SafeTaxiInvalidStateError) {
                res.status(400).json({ error: err.message });
                return;
            }
            if (err instanceof DriverDebtLimitExceededError) {
                res.status(403).json({
                    error: err.message,
                    code: "DRIVER_DEBT_LIMIT",
                });
                return;
            }
            console.error("[SafeTaxi] createRide:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
    /**
     * Rozliczenie: kierowca (JWT = driver) lub ADMIN. Prowizja platformy z env + SAFE_TAXI_PLATFORM_USER_ID.
     */
    async settleRide(req, res) {
        try {
            const uid = req.user?.id;
            const role = req.user?.role;
            if (typeof uid !== "string" || uid.length === 0) {
                res.status(401).json({ error: "Unauthorized" });
                return;
            }
            const rawId = req.params.id;
            const rideId = typeof rawId === "string"
                ? rawId
                : Array.isArray(rawId)
                    ? rawId[0]
                    : undefined;
            if (rideId === undefined || rideId.trim().length === 0) {
                res.status(400).json({ error: "Brak ID przejazdu." });
                return;
            }
            const body = req.body;
            const fareRaw = typeof body.fareCents === "string"
                ? body.fareCents.trim()
                : typeof body.fareCents === "number"
                    ? String(body.fareCents)
                    : "";
            if (fareRaw.length === 0 || !/^\d+$/.test(fareRaw)) {
                res.status(400).json({
                    error: "Wymagane pole: fareCents (całkowita liczba groszy, string lub liczba).",
                });
                return;
            }
            const fareCents = BigInt(fareRaw);
            const driverIdForRide = await this.service.getRideDriverId(rideId.trim());
            if (driverIdForRide === null) {
                res.status(404).json({ error: "Przejazd nie istnieje." });
                return;
            }
            const isAdmin = role === UserRole.ADMIN;
            const isDriver = uid === driverIdForRide;
            if (!isAdmin && !isDriver) {
                res.status(403).json({ error: "Tylko kierowca tego przejazdu lub administrator może rozliczyć." });
                return;
            }
            const result = await this.service.settleRide(rideId.trim(), fareCents);
            res.status(200).json({
                status: "success",
                data: {
                    idempotent: result.idempotent,
                    platformCommissionCents: result.platformCommissionCents.toString(),
                    driverPayoutCents: result.driverPayoutCents.toString(),
                },
            });
        }
        catch (err) {
            if (err instanceof SafeTaxiRideNotFoundError) {
                res.status(404).json({ error: "Przejazd nie istnieje." });
                return;
            }
            if (err instanceof SafeTaxiInvalidStateError) {
                res.status(400).json({ error: err.message });
                return;
            }
            if (err instanceof InsufficientFundsError) {
                res.status(402).json({ error: "Niewystarczające środki u pasażera." });
                return;
            }
            if (err instanceof DriverDebtLimitExceededError) {
                res.status(403).json({
                    error: err.message,
                    code: "DRIVER_DEBT_LIMIT",
                });
                return;
            }
            if (err instanceof WalletNotFoundError) {
                res.status(404).json({ error: "Brak portfela (pasażer, kierowca lub platforma)." });
                return;
            }
            if (err instanceof SafeTaxiConfigError) {
                res.status(503).json({ error: err.message, code: "SAFE_TAXI_CONFIG" });
                return;
            }
            console.error("[SafeTaxi] settleRide:", err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
}
//# sourceMappingURL=safe-taxi.controller.js.map