import { sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { jobs } from "../db/schema";

export type JobName =
  | "campaign.plan"
  | "experiment.send"
  | "experiment.evaluate"
  | "reply.classify"
  | "learning.writeback"
  | "sequence.followup"
  | "mailbox.poll"
  | "meeting.verify"
  | "memory.refresh"
  | "platform.drain"
  | "mock.deliverEvents"
  | "engine.tick";

export interface EnqueueOptions {
  runAt?: Date;
  /** Only one *pending* job may exist per dedupe key. */
  dedupeKey?: string;
  maxAttempts?: number;
}

export async function enqueue(
  db: DB,
  name: JobName,
  payload: Record<string, unknown> = {},
  opts: EnqueueOptions = {},
) {
  await db
    .insert(jobs)
    .values({
      name,
      payload,
      runAt: opts.runAt ?? new Date(),
      dedupeKey: opts.dedupeKey ?? null,
      maxAttempts: opts.maxAttempts ?? 5,
    })
    .onConflictDoNothing();
}

export interface ClaimedJob {
  id: string;
  name: JobName;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

const LOCK_SECONDS = 300;

/** Atomically claim the next due job (or one whose lock expired after a crash). */
export async function claimNext(db: DB): Promise<ClaimedJob | null> {
  const res = await db.execute(sql`
    UPDATE jobs SET status = 'running',
      attempts = attempts + 1,
      locked_until = now() + make_interval(secs => ${LOCK_SECONDS})
    WHERE id = (
      SELECT id FROM jobs
      WHERE (status = 'pending' AND run_at <= now())
         OR (status = 'running' AND locked_until < now())
      ORDER BY run_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, name, payload, attempts, max_attempts`);
  const row = (res as unknown as { rows: Record<string, unknown>[] }).rows[0];
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as JobName,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
  };
}

export async function completeJob(db: DB, id: string) {
  await db.execute(sql`UPDATE jobs SET status = 'done', locked_until = NULL WHERE id = ${id}`);
}

export async function failJob(db: DB, job: ClaimedJob, error: unknown) {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  if (job.attempts >= job.maxAttempts) {
    await db.execute(
      sql`UPDATE jobs SET status = 'failed', last_error = ${message}, locked_until = NULL WHERE id = ${job.id}`,
    );
    return;
  }
  const backoffSecs = Math.min(3600, 2 ** job.attempts * 15);
  // If a newer pending job with the same dedupe key exists, it supersedes this retry.
  await db.execute(sql`
    UPDATE jobs SET
      status = CASE WHEN dedupe_key IS NOT NULL AND EXISTS (
        SELECT 1 FROM jobs j2 WHERE j2.dedupe_key = jobs.dedupe_key AND j2.status = 'pending' AND j2.id <> jobs.id
      ) THEN 'done' ELSE 'pending' END,
      last_error = ${message}, locked_until = NULL,
      run_at = now() + make_interval(secs => ${backoffSecs})
    WHERE id = ${job.id}`);
}
