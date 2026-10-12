-- Ramp start/ceiling follow the raised send-cap ceiling (config.LimitMax = 5000).
ALTER TABLE campaigns DROP CONSTRAINT campaigns_ramp_start_check;
ALTER TABLE campaigns
    ADD CONSTRAINT campaigns_ramp_start_check CHECK (ramp_start >= 1 AND ramp_start <= 5000);
ALTER TABLE campaigns DROP CONSTRAINT campaigns_ramp_ceiling_check;
ALTER TABLE campaigns
    ADD CONSTRAINT campaigns_ramp_ceiling_check CHECK (ramp_ceiling >= 1 AND ramp_ceiling <= 5000);
