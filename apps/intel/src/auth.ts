import crypto from "node:crypto";
import type { MiddlewareHandler } from "hono";

/**
 * Requests reach this service only through the Pegasusbound backend's
 * /v1/intel/* proxy, which authenticates the dashboard session and signs the
 * identity: HMAC-SHA256(INTERNAL_API_TOKEN, org|user|perms|ts).
 */

export interface Identity {
  orgId: string;
  userId: string;
  perms: number;
  /** The user's dashboard token, forwarded once to mint the org's engine key. */
  userToken: string | null;
}

export type Env = { Variables: { identity: Identity } };

// Mirrors internal/models/organization_permission.go
export const PERM = {
  manageCampaigns: 1 << 2,
  sendCampaigns: 1 << 6,
  manageSettings: 1 << 9,
  viewCampaigns: 1 << 10,
} as const;

const MAX_SKEW_SECONDS = 300;

export function sign(secret: string, org: string, user: string, perms: string, ts: string) {
  return crypto.createHmac("sha256", secret).update(`${org}|${user}|${perms}|${ts}`).digest("hex");
}

export function identityMiddleware(secret: string): MiddlewareHandler<Env> {
  return async (c, next) => {
    const org = c.req.header("x-intel-org") ?? "";
    const user = c.req.header("x-intel-user") ?? "";
    const perms = c.req.header("x-intel-perms") ?? "0";
    const ts = c.req.header("x-intel-ts") ?? "";
    const sig = c.req.header("x-intel-sig") ?? "";
    const expected = sign(secret, org, user, perms, ts);
    const age = Math.abs(Date.now() / 1000 - Number(ts));
    const valid =
      org &&
      sig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) &&
      Number.isFinite(age) &&
      age <= MAX_SKEW_SECONDS;
    if (!valid) return c.json({ error: "unauthorized" }, 401);
    const auth = c.req.header("authorization");
    c.set("identity", {
      orgId: org,
      userId: user,
      perms: Number(perms) || 0,
      userToken: auth?.startsWith("Bearer ") ? auth.slice(7) : null,
    });
    await next();
  };
}

export function requirePerm(...anyOf: number[]): MiddlewareHandler<Env> {
  return async (c, next) => {
    const { perms } = c.get("identity");
    if (!anyOf.some((p) => (perms & p) === p)) return c.json({ error: "You don't have permission to do that in this workspace" }, 403);
    await next();
  };
}
