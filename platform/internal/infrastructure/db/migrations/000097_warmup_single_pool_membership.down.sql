-- Dual membership becomes possible again. The rows merged away on the way up
-- are gone; nothing can restore them, and nothing should.
DROP INDEX IF EXISTS warmup_pool_participants_account_key;
CREATE INDEX IF NOT EXISTS idx_warmup_participants_account
    ON warmup_pool_participants USING btree (email_account_id);
