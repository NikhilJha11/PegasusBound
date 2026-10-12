import type { DB } from "../db/client";
import { auditLog, type prospects } from "../db/schema";
import { env } from "../env";

export async function audit(
  db: DB,
  campaignId: string | null,
  actor: "user" | "engine" | "system",
  action: string,
  details: Record<string, unknown> = {},
) {
  await db.insert(auditLog).values({ campaignId, actor, action, details });
}

type Prospect = typeof prospects.$inferSelect;

export function renderTemplate(template: string, p: Pick<Prospect, "firstName" | "company" | "title">) {
  return template
    .replaceAll("{{first_name}}", p.firstName?.trim() || "there")
    .replaceAll("{{company}}", p.company?.trim() || "your team")
    .replaceAll("{{title}}", p.title?.trim() || "your role");
}

/**
 * Converts "campaign hours" into wall-clock ms. With the mock sender, time is
 * compressed so a 72-hour observation window takes seconds in a demo.
 */
export function campaignHoursToMs(hours: number, senderProvider: string) {
  if (senderProvider === "mock") return hours * env().MOCK_TIME_SCALE_SECONDS_PER_HOUR * 1000;
  return hours * 3600 * 1000;
}

export function startOfNextUtcDay(now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(24, 5, 0, 0);
  return d;
}

export function startOfUtcDay(now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Deterministic shuffle so assignment is reproducible from the seed. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A sending "day" for a campaign: a UTC day, or 24 scaled hours under the mock sender. */
export function campaignDayStart(senderProvider: string, now = Date.now()) {
  if (senderProvider !== "mock") return startOfUtcDay(new Date(now));
  const day = campaignHoursToMs(24, senderProvider);
  return new Date(Math.floor(now / day) * day);
}

export function campaignNextDay(senderProvider: string, now = Date.now()) {
  if (senderProvider !== "mock") return startOfNextUtcDay(new Date(now));
  return new Date(campaignDayStart(senderProvider, now).getTime() + campaignHoursToMs(24, senderProvider));
}
