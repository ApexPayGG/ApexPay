import jwt from "jsonwebtoken";
import { Server as SocketIOServer } from "socket.io";
export class WebSocketService {
    io;
    activeSessions = new Map();
    constructor(server) {
        this.io = new SocketIOServer(server, { cors: { origin: "*" } }); // Na produkcji zawęzimy origin
        // Middleware: Twarda weryfikacja tokenu JWT przed otwarciem tunelu
        this.io.use((socket, next) => {
            const token = socket.handshake.auth.token;
            if (!token) {
                return next(new Error("Brak tokenu autoryzacyjnego. Odmowa dostępu."));
            }
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                // Zapisujemy zweryfikowane ID gracza w obiekcie połączenia
                socket.data.userId = decoded.userId;
                next();
            }
            catch {
                return next(new Error("Nieprawidłowy lub wygasły token JWT."));
            }
        });
        this.io.on("connection", (socket) => {
            // Pobieramy bezpieczne ID prosto ze zdekodowanego tokenu
            const userId = socket.data.userId;
            if (userId) {
                this.activeSessions.set(userId, socket.id);
                console.log(`[ApexPay WS] Nawiązano szyfrowany kanał dla gracza: ${userId}`);
                socket.on("disconnect", () => {
                    this.activeSessions.delete(userId);
                    console.log(`[ApexPay WS] Zamknięto kanał dla gracza: ${userId}`);
                });
            }
        });
    }
    notifyWallet(userId, event, payload) {
        const socketId = this.activeSessions.get(userId);
        if (socketId !== undefined) {
            this.io.to(socketId).emit(event, payload);
            console.log(`[ApexPay WS] Wypchnięto event ${event} do ${userId}`);
        }
    }
}
//# sourceMappingURL=websocket.service.js.map