import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { assignments, campaigns, meetings, prospects } from "../db/schema";
import { findCrmMeeting } from "../crm";
import { enqueue } from "../jobs/queue";
import { audit } from "./util";

const MAX_VERIFY_ATTEMPTS = 14;

/**
 * A "meeting requested" reply is only an intention. Check the CRM's calendar
 * data daily for up to two weeks to confirm a meeting was actually booked.
 */
export async function handleMeetingVerify(db: DB, assignmentId: string, attempt: number) {
  const [row] = await db
    .select({ m: meetings, p: prospects, orgId: campaigns.orgId })
    .from(meetings)
    .innerJoin(assignments, eq(assignments.id, meetings.assignmentId))
    .innerJoin(prospects, eq(prospects.id, assignments.prospectId))
    .innerJoin(campaigns, eq(campaigns.id, meetings.campaignId))
    .where(eq(meetings.assignmentId, assignmentId));
  if (!row || row.m.status !== "requested") return;
  const res = await findCrmMeeting(db, row.orgId, row.p.email, row.m.createdAt);
  if (res.found) {
    await db
      .update(meetings)
      .set({ status: "booked", source: "crm", bookedAt: res.at ? new Date(res.at) : new Date() })
      .where(eq(meetings.id, row.m.id));
    await audit(db, row.m.campaignId, "engine", "meeting.confirmed", { prospect: row.p.email, at: res.at });
    return;
  }
  if (res.reason || attempt + 1 >= MAX_VERIFY_ATTEMPTS) return;
  await enqueue(db, "meeting.verify", { assignmentId, attempt: attempt + 1 }, { runAt: new Date(Date.now() + 24 * 3600 * 1000), dedupeKey: `meeting:${assignmentId}` });
}

export type MeetingUpdate = { status?: "requested" | "booked" | "held" | "no_show"; qualified?: boolean | null; notes?: string };

/** Manual meeting outcome from the lead's thread view. */
export async function updateMeeting(db: DB, assignmentId: string, update: MeetingUpdate, by: string) {
  const [a] = await db.select().from(assignments).where(eq(assignments.id, assignmentId));
  if (!a) throw new Error("Lead not found");
  await db
    .insert(meetings)
    .values({ campaignId: a.campaignId, assignmentId, bookedAt: new Date(), source: "manual", status: update.status ?? "booked", qualified: update.qualified ?? null, notes: update.notes ?? null })
    .onConflictDoUpdate({
      target: meetings.assignmentId,
      set: {
        ...(update.status ? { status: update.status } : {}),
        ...(update.qualified !== undefined ? { qualified: update.qualified } : {}),
        ...(update.notes !== undefined ? { notes: update.notes } : {}),
      },
    });
  await audit(db, a.campaignId, "user", "meeting.updated", { assignmentId, ...update, by });
}
