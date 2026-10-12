-- Operator override of the organization risk posture (issue #241).
--
-- The posture was pinned once it reached suspended, and the manual override
-- had no way to record that it WAS manual, so the only way out was SQL. The
-- override now lives beside the derived band: while it is set it is the
-- state, whatever the detectors write; once cleared the score decides again.
ALTER TABLE public.organizations
    ADD COLUMN risk_override text,
    ADD COLUMN risk_override_reason text,
    ADD COLUMN risk_override_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN risk_override_at timestamptz;

ALTER TABLE public.organizations
    ADD CONSTRAINT organizations_risk_override_check
    CHECK (risk_override IS NULL OR risk_override IN ('trusted', 'watch', 'restricted', 'suspended'));

COMMENT ON COLUMN public.organizations.risk_override IS
    'Operator-set posture. While present it outranks risk_score; NULL means the score decides.';

-- The expiry sweep asks which workspaces hold dated evidence. Only a small
-- fraction of an instance ever carries any, so keep it off a full scan.
CREATE INDEX idx_organizations_risk_signals_present
    ON public.organizations USING btree (id)
    WHERE risk_signals <> '{}'::jsonb;

-- Give the findings already on file the expiry they were written without.
-- The three one-shot detectors (a signup's origin, one import's list quality,
-- a run of anomalous sign-ins) have nothing that would ever retract them, so
-- without this a workspace flagged before this migration keeps their weight
-- forever and the fix only helps findings filed from now on.
UPDATE public.organizations o
   SET risk_signals = (
        SELECT jsonb_object_agg(e.key,
                 CASE
                   WHEN e.key IN ('signup', 'list_quality', 'login_anomalies')
                    AND jsonb_typeof(e.value) = 'object'
                    AND NOT (e.value ? 'expires_at')
                   THEN e.value || jsonb_build_object('expires_at',
                          to_char((NOW() + INTERVAL '30 days') AT TIME ZONE 'UTC',
                                  'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
                   ELSE e.value
                 END)
          FROM jsonb_each(o.risk_signals) e)
 WHERE o.risk_signals ?| array['signup', 'list_quality', 'login_anomalies'];
