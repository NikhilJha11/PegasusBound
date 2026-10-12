-- The banded warmup health evaluation never ran: UpdateParticipantHealth was
-- unpreparable and the pool probe treated "not in this pool" as a hard error,
-- so no mailbox has ever been judged (issue #195). With both fixed, the first
-- evaluation would otherwise reach back over signals collected while nothing
-- was watching -- including the spurious Junk placements Microsoft Graph
-- produced before #199 and #201 -- and could quarantine or block mailboxes for
-- something the platform did to itself.
--
-- This column is the floor. A signal older than it is not counted against the
-- mailbox. Existing participants are floored at the moment this migration runs;
-- new participants at the moment they join, which is the honest rule in both
-- cases (do not judge a mailbox on a period it was not being judged in). The
-- 30-day evaluation window rolls past the floor on its own, so this stops
-- mattering roughly a month after deploy without anyone having to do anything.
ALTER TABLE warmup_pool_participants
    ADD COLUMN health_signals_from timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN warmup_pool_participants.health_signals_from IS
    'Health signals older than this are not counted against the mailbox. Set to the join time for new participants, and to the #195 fix deploy for pre-existing ones.';
