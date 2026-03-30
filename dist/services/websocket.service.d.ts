import type { Server as HttpServer } from "http";
declare module "socket.io" {
    interface SocketData {
        userId?: string;
    }
}
export declare class WebSocketService {
    private readonly io;
    private readonly activeSessions;
    constructor(server: HttpServer);
    notifyWallet(userId: string, event: string, payload: unknown): void;
}
//# sourceMappingURL=websocket.service.d.ts.map