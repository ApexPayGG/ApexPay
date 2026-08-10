export class TradeNotFoundError extends Error {
  constructor() {
    super("Trade not found");
    this.name = "TradeNotFoundError";
  }
}

export class TradeInvalidStatusError extends Error {
  constructor(msg = "Invalid trade status") {
    super(msg);
    this.name = "TradeInvalidStatusError";
  }
}

export class TradeExpiredError extends Error {
  constructor() {
    super("Trade offer expired");
    this.name = "TradeExpiredError";
  }
}

export class TradePlatformConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradePlatformConfigError";
  }
}

export class TradeInsufficientFundsError extends Error {
  constructor() {
    super("Insufficient funds");
    this.name = "TradeInsufficientFundsError";
  }
}
