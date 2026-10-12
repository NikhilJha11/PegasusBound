-- Durable dwell for delayed warmup engagement actions.
--
-- The recipient-side "dwell" delay for the low-stakes engagement signals
-- (mark_read / mark_important / star) previously lived only in a worker-process
-- time.AfterFunc timer, so a worker restart mid-dwell dropped those signals with
-- no trace. This table is the durable schedule: the consumer enqueues the
-- delayed leg here with a fire_at, and a consumer-side poller publishes it to
-- the worker when due. The reputation-critical leg (folder + spam-rescue) is
-- still published immediately and is unaffected.
--
-- Control-plane only: written and drained by the consumer (Postgres-backed),
-- never by the worker.

CREATE TABLE public.warmup_pending_engagements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email_account_id uuid NOT NULL,
    payload jsonb NOT NULL,
    fire_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT warmup_pending_engagements_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_warmup_pending_engagements_due ON public.warmup_pending_engagements USING btree (fire_at);
