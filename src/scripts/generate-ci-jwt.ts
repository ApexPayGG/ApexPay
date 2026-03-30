/**
 * CI: podpisuje testowy JWT (payload.userId) — używany jako STRESS_JWT.
 * Wymaga JWT_SECRET w środowisku. Na stdout tylko token (jedna linia).
 */
import "dotenv/config";
import jwt from "jsonwebtoken";

const secret = process.env.JWT_SECRET?.trim();
if (secret === undefined || secret.length === 0) {
  console.error("[generate-ci-jwt] Brak JWT_SECRET.");
  process.exit(1);
}

const userId =
  process.env.CI_STRESS_USER_ID?.trim() ?? "ci-stress-automation-user";

const token = jwt.sign({ userId }, secret, {
  expiresIn: "2h",
  issuer: "apexpay-ci",
});

process.stdout.write(token);
