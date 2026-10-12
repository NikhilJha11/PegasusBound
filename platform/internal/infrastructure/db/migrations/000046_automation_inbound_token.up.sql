-- Inbound webhook trigger: an automation whose trigger is "inbound.webhook" gets
-- a high-entropy token embedded in a public POST URL. An external system hitting
-- that URL runs this automation's graph with the JSON body as the event payload.
-- Token is the credential, so it is globally unique (partial index skips the
-- NULLs that every non-inbound automation carries).
ALTER TABLE automations ADD COLUMN inbound_token text;

CREATE UNIQUE INDEX idx_automations_inbound_token
    ON automations (inbound_token)
    WHERE inbound_token IS NOT NULL;
