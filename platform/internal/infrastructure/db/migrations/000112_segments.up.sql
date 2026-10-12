-- Contact segments (issue #266). Membership is evaluated at read time; only
-- the definition and the manual overrides are stored.
CREATE TABLE public.segments (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    color character varying(7) NOT NULL DEFAULT '#0284c7',
    match text NOT NULL DEFAULT 'all',
    conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT segments_color_check CHECK (color ~* '^#[a-f0-9]{6}$'),
    CONSTRAINT segments_match_check CHECK (match IN ('all', 'any')),
    CONSTRAINT segments_conditions_check CHECK (jsonb_typeof(conditions) = 'array')
);

CREATE UNIQUE INDEX segments_org_name_unique ON public.segments (organization_id, lower(name));

COMMENT ON COLUMN public.segments.conditions IS
    'Filter list, validated at the app boundary (models.SegmentCondition); match says whether all or any must hold.';

-- Manual overrides: an included contact is a member whether or not it matches
-- the conditions, an excluded one is never a member even when it does.
CREATE TABLE public.segment_members (
    segment_id uuid NOT NULL REFERENCES public.segments(id) ON DELETE CASCADE,
    contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    mode text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (segment_id, contact_id),
    CONSTRAINT segment_members_mode_check CHECK (mode IN ('include', 'exclude'))
);

CREATE INDEX idx_segment_members_contact ON public.segment_members (contact_id);
