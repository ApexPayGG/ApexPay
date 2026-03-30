import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthService } from "../services/auth.service.js";
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
} from "../services/auth.service.js";
import { AuthController } from "./auth.controller.js";

const mockRegisterUser = vi.fn();
const mockLoginUser = vi.fn();

function createController() {
  const authService = {
    registerUser: mockRegisterUser,
    loginUser: mockLoginUser,
  } as unknown as AuthService;
  return new AuthController(authService);
}

/** Express-like request (bez zależności od paczki express w tym teście). */
type RegisterBody = { email?: string; password?: string };
type MockRequest = { body: RegisterBody };

function createMockResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
    cookie: vi.fn().mockReturnThis(),
  };
  res.status.mockImplementation(() => res);
  return res as {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    cookie: ReturnType<typeof vi.fn>;
  };
}

describe("AuthController.register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegisterUser.mockReset();
    mockLoginUser.mockReset();
  });

  it("returns 201 and serializes BigInt fields to strings in JSON body", async () => {
    const createdAt = new Date("2026-01-15T12:00:00.000Z");
    const updatedAt = new Date("2026-01-15T12:00:00.000Z");
    mockRegisterUser.mockResolvedValue({
      id: "usr_1",
      email: "player@example.com",
      createdAt,
      updatedAt,
      walletBalance: 0n,
    });

    const req: MockRequest = {
      body: { email: "Player@Example.COM", password: "validpassword12" },
    };
    const res = createMockResponse();

    const controller = createController();
    await controller.register(req as never, res as never);

    expect(mockRegisterUser).toHaveBeenCalledWith(
      "Player@Example.COM",
      "validpassword12",
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledTimes(1);
    const payload = res.json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      id: "usr_1",
      email: "player@example.com",
      walletBalance: "0",
    });
    expect(typeof payload?.walletBalance).toBe("string");
  });

  it("returns 400 when email or password is missing from payload", async () => {
    const controller = createController();

    const reqMissingEmail: MockRequest = {
      body: { password: "validpassword12" },
    };
    const res1 = createMockResponse();
    await controller.register(reqMissingEmail as never, res1 as never);
    expect(res1.status).toHaveBeenCalledWith(400);
    expect(mockRegisterUser).not.toHaveBeenCalled();

    const reqMissingPassword: MockRequest = {
      body: { email: "player@example.com" },
    };
    const res2 = createMockResponse();
    await controller.register(reqMissingPassword as never, res2 as never);
    expect(res2.status).toHaveBeenCalledWith(400);
    expect(mockRegisterUser).not.toHaveBeenCalled();
  });

  it("returns 409 when AuthService throws EmailAlreadyRegisteredError", async () => {
    mockRegisterUser.mockRejectedValue(new EmailAlreadyRegisteredError());

    const req: MockRequest = {
      body: { email: "taken@example.com", password: "validpassword12" },
    };
    const res = createMockResponse();

    const controller = createController();
    await controller.register(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalled();
  });
});

describe("AuthController.login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegisterUser.mockReset();
    mockLoginUser.mockReset();
  });

  it("returns 400 when email or password is missing from payload", async () => {
    const controller = createController();

    const reqMissingEmail: MockRequest = {
      body: { password: "validpassword12" },
    };
    const res1 = createMockResponse();
    await controller.login(reqMissingEmail as never, res1 as never);
    expect(res1.status).toHaveBeenCalledWith(400);
    expect(mockLoginUser).not.toHaveBeenCalled();

    const reqMissingPassword: MockRequest = {
      body: { email: "player@example.com" },
    };
    const res2 = createMockResponse();
    await controller.login(reqMissingPassword as never, res2 as never);
    expect(res2.status).toHaveBeenCalledWith(400);
    expect(mockLoginUser).not.toHaveBeenCalled();
  });

  it("returns 401 when AuthService throws InvalidCredentialsError", async () => {
    mockLoginUser.mockRejectedValue(new InvalidCredentialsError());

    const req: MockRequest = {
      body: { email: "ghost@example.com", password: "validpassword12" },
    };
    const res = createMockResponse();

    const controller = createController();
    await controller.login(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalled();
  });

  it("returns 200 with token in httpOnly cookie and token + user fields in JSON (API / automacja)", async () => {
    const createdAt = new Date("2026-02-01T10:00:00.000Z");
    const updatedAt = new Date("2026-02-01T10:00:00.000Z");
    mockLoginUser.mockResolvedValue({
      token: "zmockowany_token",
      user: {
        id: "usr_ok",
        email: "player@example.com",
        createdAt,
        updatedAt,
      },
    });

    const req: MockRequest = {
      body: { email: "player@example.com", password: "validpassword12" },
    };
    const res = createMockResponse();

    const controller = createController();
    await controller.login(req as never, res as never);

    expect(mockLoginUser).toHaveBeenCalledWith("player@example.com", "validpassword12");
    expect(res.cookie).toHaveBeenCalledWith("jwt", "zmockowany_token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 86400000,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      token: "zmockowany_token",
      id: "usr_ok",
      email: "player@example.com",
      createdAt,
      updatedAt,
    });
  });
});