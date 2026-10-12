import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { DB } from "./db/client";
import { assignments, campaigns, prospects, suppressions, users } from "./db/schema";
import { env } from "./env";
import { verifyUnsubscribeToken } from "./compliance";
import { audit } from "./orchestrator/util";

const SESSION_DAYS = 14;

function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function checkPassword(password: string, stored: string) {
  const [, salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}

export async function userCount(db: DB) {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(users);
  return Number(row?.n ?? 0);
}

/** Only allowed when no users exist yet (first-run owner setup) or by a signed-in user. */
export async function createUser(db: DB, input: { email: string; name?: string; password: string }) {
  if (input.password.length < 10) throw new Error("Password must be at least 10 characters");
  const [row] = await db
    .insert(users)
    .values({ email: input.email.trim().toLowerCase(), name: input.name ?? null, passwordHash: hashPassword(input.password) })
    .returning();
  return row!;
}

export async function verifyLogin(db: DB, email: string, password: string) {
  const [u] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  if (!u || !checkPassword(password, u.passwordHash)) return null;
  return u;
}

/** Session cookie value: base64url(payload).hmac — verifiable on the edge with Web Crypto. */
export function createSessionToken(email: string) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + SESSION_DAYS * 86400000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", env().APP_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function readSessionToken(token: string | undefined): { email: string } | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", env().APP_SECRET).update(payload).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email: string; exp: number };
  return data.exp > Date.now() ? { email: data.email } : null;
}

export const SESSION_COOKIE = "iole_session";

/** Recipient clicked the unsubscribe link (or their client sent a one-click POST). */
export async function unsubscribeByToken(db: DB, token: string) {
  const assignmentId = verifyUnsubscribeToken(token);
  if (!assignmentId) return { ok: false as const };
  const [row] = await db
    .select({ a: assignments, email: prospects.email, orgId: campaigns.orgId })
    .from(assignments)
    .innerJoin(prospects, eq(prospects.id, assignments.prospectId))
    .innerJoin(campaigns, eq(campaigns.id, assignments.campaignId))
    .where(eq(assignments.id, assignmentId));
  if (!row) return { ok: false as const };
  await db.insert(suppressions).values({ orgId: row.orgId, email: row.email, reason: "unsubscribed", source: "link" }).onConflictDoNothing();
  if (!row.a.sequenceStoppedReason) await db.update(assignments).set({ sequenceStoppedReason: "unsubscribed" }).where(eq(assignments.id, assignmentId));
  await audit(db, row.a.campaignId, "system", "recipient.unsubscribed", { assignmentId });
  return { ok: true as const, email: row.email };
}
