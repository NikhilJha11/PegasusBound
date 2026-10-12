import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, type DB } from "../db/client";
import { campaigns, experiments, STANDALONE_ORG } from "../db/schema";
import { claimNext, completeJob, enqueue, failJob, type ClaimedJob, type JobName } from "./queue";
import { handlePlan } from "../orchestrator/campaigns";
import { handleFollowUp, handleSend } from "../orchestrator/send";
import { handleMeetingVerify } from "../orchestrator/meetings";
import { refreshMemory } from "../memory";
import { allSenders } from "../senders";
import { checkMailboxHealth } from "../senders/mailboxes";
import { drainPlatformOutbox, platformOutboxAvailable } from "../platform/bridge";
import { handleClassify, ingestEvent } from "../orchestrator/events";
import { handleEvaluate } from "../orchestrator/evaluate";
import { handleWriteback } from "../orchestrator/writeback";
import { audit } from "../orchestrator/util";
import type { MessageEventType } from "../db/schema";

const TICK_MS = 60_000;
const QUIET_JOBS = new Set<JobName>(["engine.tick", "mock.deliverEvents", "platform.drain", "mailbox.poll"]);

type Handler = (db: DB, payload: Record<string, unknown>, job: ClaimedJob) => Promise<void>;

const handlers: Record<JobName, Handler> = {
  "campaign.plan": (db, p) => handlePlan(db, p.campaignId as string),
  "experiment.send": (db, p) => handleSend(db, p.experimentId as string),
  "experiment.evaluate": (db, p) => handleEvaluate(db, p.experimentId as string, Number(p.deferrals ?? 0)),
  "reply.classify": (db, p) => handleClassify(db, p.replyId as string),
  "learning.writeback": (db, p) => handleWriteback(db, p.learningId as string),
  "sequence.followup": (db, p) => handleFollowUp(db, p.assignmentId as string, Number(p.step)),
  "meeting.verify": (db, p) => handleMeetingVerify(db, p.assignmentId as string, Number(p.attempt ?? 0)),
  "platform.drain": async (db) => {
    if (!(await platformOutboxAvailable(db))) return;
    // Keep draining while there's backlog, then check again shortly.
    let n = 0;
    do n = await drainPlatformOutbox(db);
    while (n === 200);
    await enqueue(db, "platform.drain", {}, { runAt: new Date(Date.now() + 5000), dedupeKey: "platform.drain", maxAttempts: 1 });
  },
  "memory.refresh": (db, p) => refreshMemory(db, (p.orgId as string | undefined) ?? STANDALONE_ORG),
  "mailbox.poll": async (db) => {
    for (const sender of allSenders()) {
      if (!sender.poll) continue;
      for (const e of await sender.poll(db)) await ingestEvent(db, e);
    }
  },
  "mock.deliverEvents": async (db, p) => {
    const e = p.event as { providerMessageId: string; providerEventId: string; type: MessageEventType; replyBody?: string; fromEmail?: string };
    await ingestEvent(db, { ...e, occurredAt: new Date() });
  },
  "engine.tick": async (db) => {
    await recover(db);
    await checkMailboxHealth(db);
    await enqueue(db, "mailbox.poll", {}, { dedupeKey: "mailbox.poll", maxAttempts: 1 });
    await enqueue(db, "platform.drain", {}, { dedupeKey: "platform.drain", maxAttempts: 1 });
    await enqueue(db, "engine.tick", {}, { runAt: new Date(Date.now() + TICK_MS), dedupeKey: "engine.tick" });
  },
};

/**
 * Self-healing sweep: make sure every running experiment has a job that will
 * move it forward, even after crashes, deploys or lost jobs.
 */
async function recover(db: DB) {
  const stuck = await db
    .select({ exp: experiments })
    .from(experiments)
    .innerJoin(campaigns, eq(campaigns.id, experiments.campaignId))
    .where(and(eq(campaigns.status, "running"), inArray(experiments.status, ["sending", "observing"])));
  for (const { exp } of stuck) {
    if (exp.status === "sending") await enqueue(db, "experiment.send", { experimentId: exp.id }, { dedupeKey: `send:${exp.id}` });
    else if (exp.observeUntil && exp.observeUntil < new Date())
      await enqueue(db, "experiment.evaluate", { experimentId: exp.id }, { dedupeKey: `eval:${exp.id}` });
  }
  // Planning that crashed past its retries -> surface as failed instead of hanging.
  await db.execute(sql`
    UPDATE campaigns SET status = 'failed', status_detail = 'Planning failed; see job errors'
    WHERE status = 'planning' AND EXISTS (
      SELECT 1 FROM jobs j WHERE j.name = 'campaign.plan' AND j.status = 'failed'
        AND j.payload->>'campaignId' = campaigns.id::text)`);
}

export interface EngineHandle {
  stop: () => Promise<void>;
}

/** Start the background engine loop in this process. */
export async function startEngine(opts: { concurrency?: number; idleMs?: number; log?: (msg: string) => void } = {}): Promise<EngineHandle> {
  const db = await getDb();
  const { concurrency = 4, idleMs = 1000, log = (m: string) => console.log(`[engine] ${m}`) } = opts;
  let running = true;
  await enqueue(db, "engine.tick", {}, { dedupeKey: "engine.tick" });

  const loop = async () => {
    while (running) {
      let job: ClaimedJob | null = null;
      try {
        job = await claimNext(db);
      } catch (err) {
        log(`claim failed: ${err instanceof Error ? err.message : err}`);
      }
      if (!job) {
        await new Promise((r) => setTimeout(r, idleMs));
        continue;
      }
      try {
        await handlers[job.name](db, job.payload, job);
        await completeJob(db, job.id);
        // Routine high-frequency jobs stay quiet; everything else is logged.
        if (!QUIET_JOBS.has(job.name)) log(`${job.name} ok`);
      } catch (err) {
        log(`${job.name} failed (attempt ${job.attempts}/${job.maxAttempts}): ${err instanceof Error ? err.message : err}`);
        await failJob(db, job, err);
        const campaignId = (job.payload.campaignId as string | undefined) ?? null;
        if (job.name === "campaign.plan" && campaignId && job.attempts >= job.maxAttempts) {
          // Tell the user why, instead of leaving the campaign "planning" forever.
          const reason = err instanceof Error ? err.message : String(err);
          await db
            .update(campaigns)
            .set({ status: "failed", statusDetail: `Planning failed: ${reason.slice(0, 300)}` })
            .where(eq(campaigns.id, campaignId))
            .catch(() => {});
        }
        await audit(db, campaignId, "system", "job.failed", { job: job.name, attempt: job.attempts, error: String(err) }).catch(() => {});
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => loop());
  log(`started with concurrency ${concurrency}`);
  return {
    stop: async () => {
      running = false;
      await Promise.all(workers);
    },
  };
}

/** Run jobs until the queue has nothing due (for tests and scripts). */
export async function drain(db: DB, opts: { maxJobs?: number } = {}) {
  let n = 0;
  for (;;) {
    const job = await claimNext(db);
    if (!job) return n;
    if (job.name === "engine.tick") {
      await completeJob(db, job.id);
      continue;
    }
    try {
      await handlers[job.name](db, job.payload, job);
      await completeJob(db, job.id);
    } catch (err) {
      await failJob(db, job, err);
      throw err;
    }
    if (++n >= (opts.maxJobs ?? 100000)) return n;
  }
}
