-- Deal attribution + scale indexes.
--
-- Attribution: tie a deal back to the campaign and the sender mailbox that
-- produced the reply, so won revenue traces to the outreach that created it.
-- Both columns are nullable and ON DELETE SET NULL so attribution survives
-- campaign / mailbox cleanup instead of cascading away won-revenue history
-- (mirrors the existing deals.contact_id ON DELETE SET NULL behaviour).
--
-- Indexes back the new faceted POST /crm/deals/search + /crm/deals/summary
-- surfaces: "my open deals" (org, owner, status), per-stage value rollups for
-- board column headers (stage, status, value), and per-campaign revenue
-- (campaign, status, value). Previously every one of these scanned.

ALTER TABLE deals
    ADD COLUMN IF NOT EXISTS campaign_id uuid,
    ADD COLUMN IF NOT EXISTS source_mailbox_id uuid;

ALTER TABLE deals
    ADD CONSTRAINT deals_campaign_id_fkey FOREIGN KEY (campaign_id)
        REFERENCES campaigns (id) ON DELETE SET NULL,
    ADD CONSTRAINT deals_source_mailbox_id_fkey FOREIGN KEY (source_mailbox_id)
        REFERENCES email_accounts (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deals_org_assigned_status
    ON deals (organization_id, assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_deals_stage_status_value
    ON deals (stage_id, status, value);
CREATE INDEX IF NOT EXISTS idx_deals_campaign_status_value
    ON deals (campaign_id, status, value);
