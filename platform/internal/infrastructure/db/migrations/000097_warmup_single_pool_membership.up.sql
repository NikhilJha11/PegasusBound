-- A mailbox belongs to exactly one warmup pool. Nothing in the product places a
-- mailbox in two: partner selection resolves one pool type per mailbox, and
-- every reputation writer on this table (health, spam score, blocking) is
-- account-scoped, so two rows are two ledgers for one reputation.
--
-- They were still reachable (issue #211). Join and removal were both scoped to
-- the pool the mailbox is entitled to RIGHT NOW, so a mailbox whose entitlement
-- changed acquired a row in its new pool while the old row was never handed to
-- any removal. A downgraded mailbox kept its premium row and went on being
-- offered to paying customers as a warmup partner, and its spam score was
-- counted once per row by the evaluator.
--
-- This migration collapses any dual membership that already exists and makes
-- the invariant structural.

-- 1. Merge reputation before collapsing. The account-scoped writers keep two
--    rows in agreement, but a row created AFTER the mailbox earned a penalty
--    starts clean (healthy, score 0), so collapsing to an arbitrary row could
--    launder a block. Worst-wins on every column.
UPDATE warmup_pool_participants t
SET health_state         = m.health_state,
    blocked_reason       = m.blocked_reason,
    last_health_reason   = m.last_health_reason,
    spam_score           = m.spam_score,
    joined_at            = m.joined_at,
    health_signals_from  = m.health_signals_from,
    blocked_at           = m.blocked_at,
    blocked_until        = m.blocked_until,
    last_health_score    = m.last_health_score,
    participant_role     = m.participant_role
FROM (
    SELECT DISTINCT ON (email_account_id)
        email_account_id,
        health_state,
        blocked_reason,
        last_health_reason,
        MAX(spam_score)          OVER (PARTITION BY email_account_id) AS spam_score,
        MIN(joined_at)           OVER (PARTITION BY email_account_id) AS joined_at,
        MIN(health_signals_from) OVER (PARTITION BY email_account_id) AS health_signals_from,
        MIN(blocked_at)          OVER (PARTITION BY email_account_id) AS blocked_at,
        -- A blocked row with no blocked_until is blocked indefinitely (appeal
        -- only), which is the longest block there is, not a missing value that
        -- MAX may skip over in favour of a sibling's expiry.
        CASE
            WHEN BOOL_OR(
                health_state = 'blocked'
                AND blocked_at IS NOT NULL
                AND blocked_until IS NULL
            ) OVER (PARTITION BY email_account_id) THEN NULL
            ELSE MAX(blocked_until) OVER (PARTITION BY email_account_id)
        END AS blocked_until,
        MAX(last_health_score)   OVER (PARTITION BY email_account_id) AS last_health_score,
        -- 'recipient_only' sorts before 'sender_receiver': the quieter role wins.
        MIN(participant_role)    OVER (PARTITION BY email_account_id) AS participant_role,
        COUNT(*)                 OVER (PARTITION BY email_account_id) AS memberships
    FROM warmup_pool_participants
    ORDER BY email_account_id,
             CASE health_state
                 WHEN 'blocked'     THEN 5
                 WHEN 'quarantined' THEN 4
                 WHEN 'throttled'   THEN 3
                 WHEN 'watch'       THEN 2
                 ELSE 1
             END DESC,
             spam_score DESC
) m
WHERE t.email_account_id = m.email_account_id
  AND m.memberships > 1;

-- 2. Keep the row for the pool the mailbox is entitled to now, dropping the
--    rest. A mailbox whose entitlement cannot be told apart keeps its free row:
--    the lower-trust pool is the safe side of the guess.
DELETE FROM warmup_pool_participants d
USING (
    SELECT wpp.pool_id,
           wpp.email_account_id,
           ROW_NUMBER() OVER (
               PARTITION BY wpp.email_account_id
               ORDER BY (wp.pool_type::text = COALESCE(NULLIF(ea.warmup_pool_type, ''), 'free')) DESC,
                        wp.pool_type::text ASC
           ) AS rn
    FROM warmup_pool_participants wpp
    JOIN warmup_pools wp ON wp.id = wpp.pool_id
    JOIN email_accounts ea ON ea.id = wpp.email_account_id
) k
WHERE d.pool_id = k.pool_id
  AND d.email_account_id = k.email_account_id
  AND k.rn > 1;

-- 3. One pool per mailbox, enforced by the database rather than by every caller
--    remembering to pass the historical pool type. The unique index also lets
--    the join become a single upsert that MOVES the row (carrying the mailbox's
--    reputation with it) instead of adding a second one.
DROP INDEX IF EXISTS idx_warmup_participants_account;
CREATE UNIQUE INDEX warmup_pool_participants_account_key
    ON warmup_pool_participants (email_account_id);

COMMENT ON INDEX warmup_pool_participants_account_key IS
    'A mailbox is in exactly one warmup pool. Free and premium warmup traffic must not mix, and reputation on this table is per mailbox, not per pool (issue #211).';
