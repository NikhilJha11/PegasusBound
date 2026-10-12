-- Default stop_on_reply ON for newly created campaigns. Continuing to cold-email
-- a contact who already replied is the classic deliverability / complaint-rate
-- mistake, so the safe default is to stop the normal sequence on a human reply.
--
-- This only changes the DEFAULT for rows that don't specify the column; existing
-- campaigns keep whatever value they were created with (we do NOT rewrite live
-- campaign behavior). The reply-flow handling itself is route-aware in the
-- scheduler: stop_on_reply halts the cold sequence but lets the reply branch's
-- own path (its actions and any follow-up emails) run to completion.
ALTER TABLE campaigns ALTER COLUMN stop_on_reply SET DEFAULT true;
