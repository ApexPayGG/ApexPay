import type { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import type { Socket } from "socket.io";
import { Server as SocketIOServer } from "socket.io";

declare module "socket.io" {
  interface SocketData {
    userId?: string;
  }
}

export class WebSocketService {
  private readonly io: SocketIOServer;
  private readonly activeSessions: Map<string, string> = new Map();

  constructor(server: HttpServer) {
    this.io = new SocketIOServer(server, { cors: { origin: "*" } }); // Na produkcji zawęzimy origin

    // Middleware: Twarda weryfikacja tokenu JWT przed otwarciem tunelu
    this.io.use((socket, next) => {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error("Brak tokenu autoryzacyjnego. Odmowa dostępu."));
      }
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as {
          userId: string;
        };
        // Zapisujemy zweryfikowane ID gracza w obiekcie połączenia
        socket.data.userId = decoded.userId;
        next();
      } catch {
        return next(new Error("Nieprawidłowy lub wygasły token JWT."));
      }
    });

    this.io.on("connection", (socket: Socket) => {
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

  public notifyWallet(userId: string, event: string, payload: unknown): void {
    const socketId = this.activeSessions.get(userId);
    if (socketId !== undefined) {
      this.io.to(socketId).emit(event, payload);
      console.log(`[ApexPay WS] Wypchnięto event ${event} do ${userId}`);
    }
  }
}
