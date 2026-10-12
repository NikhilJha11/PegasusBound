import crypto from "node:crypto";
import { env } from "./env";

const key = () => crypto.createHash("sha256").update(env().APP_SECRET).digest();

export function encryptJson(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decryptJson<T>(payload: string | null | undefined): T | undefined {
  if (!payload) return undefined;
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv!);
  decipher.setAuthTag(tag!);
  return JSON.parse(Buffer.concat([decipher.update(data!), decipher.final()]).toString("utf8")) as T;
}

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
