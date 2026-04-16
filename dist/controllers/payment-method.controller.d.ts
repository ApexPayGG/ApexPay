import type { Request, Response } from "express";
import { PaymentMethodService } from "../services/payment-method.service.js";
export declare class PaymentMethodController {
    private readonly service;
    constructor(service: PaymentMethodService);
    create(req: Request, res: Response): Promise<void>;
    list(req: Request, res: Response): Promise<void>;
}
//# sourceMappingURL=payment-method.controller.d.ts.map