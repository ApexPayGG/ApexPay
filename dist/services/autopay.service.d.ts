export type CreateAutopayPaymentLinkParams = {
    orderId: string;
    amount: string;
    currency: string;
    customerEmail: string;
    description: string;
    returnUrl?: string;
};
export type AutopayItnData = {
    ServiceID: string;
    OrderID: string;
    RemoteID: string;
    Amount: string;
    Currency: string;
    PaymentStatus: string;
    Hash: string;
    CustomerHash?: string;
};
export declare class AutopayService {
    createPaymentLink(params: CreateAutopayPaymentLinkParams): string;
    parseItn(base64Xml: string): Promise<AutopayItnData>;
    verifyItnHash(itn: AutopayItnData): boolean;
}
//# sourceMappingURL=autopay.service.d.ts.map