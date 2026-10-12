-- One-way data repair: the misclassified verdicts it cleared were wrong, and
-- the reasons that identified them are gone with them. Re-marking those
-- contacts 'invalid' would restore the bug, so the down migration is a no-op.
SELECT 1;
