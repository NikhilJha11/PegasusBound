-- Revert the column default back to the original false.
ALTER TABLE campaigns ALTER COLUMN stop_on_reply SET DEFAULT false;
