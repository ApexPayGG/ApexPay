import type { Buffer } from "node:buffer";

declare global {
  namespace Express {
    interface Request {
      /** Surowe body JSON (HMAC webhook); ustawiane przez `express.json({ verify })`. */
      rawBody?: Buffer;
    }
  }
}

export {};
