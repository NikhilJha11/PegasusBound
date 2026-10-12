DROP INDEX IF EXISTS public.idx_organizations_risk_signals_present;

ALTER TABLE public.organizations
    DROP CONSTRAINT IF EXISTS organizations_risk_override_check;

ALTER TABLE public.organizations
    DROP COLUMN IF EXISTS risk_override_at,
    DROP COLUMN IF EXISTS risk_override_by,
    DROP COLUMN IF EXISTS risk_override_reason,
    DROP COLUMN IF EXISTS risk_override;
