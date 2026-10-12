-- Move the two remaining DynamoDB-backed tables into Postgres so DynamoDB can
-- be removed entirely.
--
-- 1. email_message_map: the worker's messageId -> internal (id, threadId) map,
--    used during mailbox sync to dedupe incoming messages and resolve threads.
--    Previously the DynamoDB "EmailMessageData" table. The worker reaches this
--    over the internal backend API (it must not open Postgres directly), so the
--    table lives here in the control plane.
--
--    The DynamoDB table keyed only on (userId, messageId) but every call site
--    also passes the mailbox emailId; we make the composite (user_id, email_id,
--    message_id) the canonical key so the same provider messageId across two of
--    a user's mailboxes no longer collides.
--
-- 2. email_history_ids: the consumer's per-mailbox Gmail history cursor.
--    Previously the DynamoDB "EmailHistoryID" table. The consumer already owns
--    Postgres, so it moves here directly.

CREATE TABLE public.email_message_map (
    user_id uuid NOT NULL,
    email_id uuid NOT NULL,
    message_id text NOT NULL,
    id uuid NOT NULL,
    thread_id text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.email_message_map
    ADD CONSTRAINT email_message_map_pkey PRIMARY KEY (user_id, email_id, message_id);

ALTER TABLE ONLY public.email_message_map
    ADD CONSTRAINT email_message_map_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

CREATE INDEX idx_email_message_map_user_email ON public.email_message_map USING btree (user_id, email_id);

CREATE TABLE public.email_history_ids (
    user_id uuid NOT NULL,
    email_id uuid NOT NULL,
    history_id bigint NOT NULL,
    last_updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.email_history_ids
    ADD CONSTRAINT email_history_ids_pkey PRIMARY KEY (user_id, email_id);

ALTER TABLE ONLY public.email_history_ids
    ADD CONSTRAINT email_history_ids_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
