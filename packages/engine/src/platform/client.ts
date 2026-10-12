import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { orgCredentials } from "../db/schema";
import { decryptJson, encryptJson } from "../crypto";
import { env } from "../env";

/**
 * Thin client for the Pegasusbound platform API (the Go backend). The engine
 * talks to it over the private network with a per-organization API key, so
 * background work (enrolling batches, pausing campaigns) runs without a user.
 */

export class PlatformError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
  }
}

/** Permissions the engine's key needs (see docs/api/permissions). */
export const ENGINE_KEY_PERMISSIONS =
  1 /* READ_EMAILS */ |
  2 /* READ_CAMPAIGNS */ |
  4 /* READ_CONTACTS */ |
  8 /* READ_UNIBOX */ |
  16 /* READ_ANALYTICS */ |
  64 /* WRITE_CAMPAIGNS */ |
  128 /* WRITE_CONTACTS */ |
  16384; /* SEND_CAMPAIGNS */

export const platformBaseUrl = () => env().PLATFORM_API_URL.replace(/\/+$/, "");

export async function platformRequest<T = unknown>(
  token: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  opts: { idempotencyKey?: string; timeoutMs?: number } = {},
): Promise<T> {
  const res = await fetch(`${platformBaseUrl()}/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  const text = await res.text();
  const parsed = text ? safeJson(text) : undefined;
  if (!res.ok) {
    // Platform errors are { error, message, code, request_id }: message carries the detail.
    const body = (typeof parsed === "object" && parsed ? parsed : {}) as { error?: string; message?: string; code?: string };
    const msg = [body.message ?? body.error ?? text.slice(0, 200), body.code ? `(${body.code})` : ""].filter(Boolean).join(" ");
    throw new PlatformError(`${method} ${path} → ${res.status}: ${msg}`, res.status, parsed);
  }
  return parsed as T;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface PlatformIdentity {
  user_id: string;
  email: string;
  name?: string;
  organization_id: string;
  organization_name?: string;
  auth_type: string;
}

/** Validate a caller's credential (dashboard JWT or API key) and learn who they are. */
export async function whoAmI(token: string): Promise<PlatformIdentity> {
  return platformRequest<PlatformIdentity>(token, "GET", "/me");
}

/**
 * Make sure the engine holds an API key for this organization, minting one
 * with the signed-in user's session the first time. The key is stored
 * encrypted and only ever used server-side.
 */
export async function ensureOrgKey(db: DB, orgId: string, userToken: string, userEmail: string) {
  const [existing] = await db.select().from(orgCredentials).where(eq(orgCredentials.orgId, orgId));
  if (existing) return;
  const res = await platformRequest<{ key?: string; api_key?: string; secret?: string; data?: { key?: string } }>(
    userToken,
    "POST",
    "/api-keys",
    {
      name: "Pegasusbound Intelligence",
      description: "Used by the intelligence engine to run experiments in the background. Revoking it pauses AI campaigns.",
      permissions: ENGINE_KEY_PERMISSIONS,
    },
    { idempotencyKey: `intel-key:${orgId}` },
  );
  const key = res.key ?? res.api_key ?? res.secret ?? res.data?.key;
  if (!key) throw new Error("Platform did not return an API key secret");
  await db
    .insert(orgCredentials)
    .values({ orgId, secret: encryptJson({ key }), createdBy: userEmail })
    .onConflictDoNothing();
}

export async function orgKey(db: DB, orgId: string): Promise<string> {
  const [row] = await db.select().from(orgCredentials).where(eq(orgCredentials.orgId, orgId));
  const key = decryptJson<{ key: string }>(row?.secret)?.key;
  if (!key) throw new Error(`No platform credential for organization ${orgId}; open Intelligence once to provision it`);
  return key;
}

export const idem = (...parts: string[]) => crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
