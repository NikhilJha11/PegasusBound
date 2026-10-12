-- Clamp any rows above the old ceiling before restoring the tighter checks.
UPDATE campaigns
SET ramp_start   = LEAST(ramp_start, 100),
    ramp_ceiling = LEAST(ramp_ceiling, 100)
WHERE ramp_start > 100 OR ramp_ceiling > 100;
ALTER TABLE campaigns DROP CONSTRAINT campaigns_ramp_start_check;
ALTER TABLE campaigns
    ADD CONSTRAINT campaigns_ramp_start_check CHECK (ramp_start >= 1 AND ramp_start <= 100);
ALTER TABLE campaigns DROP CONSTRAINT campaigns_ramp_ceiling_check;
ALTER TABLE campaigns
    ADD CONSTRAINT campaigns_ramp_ceiling_check CHECK (ramp_ceiling >= 1 AND ramp_ceiling <= 100);
