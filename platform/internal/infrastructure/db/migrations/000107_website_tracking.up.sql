-- Website visitor tracking (issue #255, section 13).
--
-- A workspace can install a snippet on its own site and see which pages a
-- contact visited in the contact timeline. Three relations:
--
--   website_tracking_settings  one row per workspace: the public site key the
--                              snippet carries, the consent mode, the location
--                              precision and the retention window
--   website_visitors           one row per browser (the visitor id the snippet
--                              keeps in first-party storage), linked to a
--                              contact once an email-link ticket identifies it
--   website_page_hits          one row per counted page view, enriched on the
--                              server (device from the user agent, location
--                              from the IP). The IP itself is never stored.
--
-- Retention is enforced by the backend job in internal/jobs; the window is
-- per workspace and bounded by the CHECK below.

CREATE TABLE public.website_tracking_settings (
    organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    enabled boolean NOT NULL DEFAULT false,
    -- Public identifier embedded in the snippet. Not a secret: it only routes a
    -- hit to a workspace and can be rotated from the dashboard.
    site_key text NOT NULL UNIQUE,
    -- explicit: nothing is recorded until the page calls pegasusbound('consent','granted').
    -- implicit: recorded on load; the workspace asserts its own lawful basis.
    consent_mode text NOT NULL DEFAULT 'explicit'
        CHECK (consent_mode IN ('explicit', 'implicit')),
    -- How much of the IP-derived location is kept: none | country | city.
    location_precision text NOT NULL DEFAULT 'country'
        CHECK (location_precision IN ('none', 'country', 'city')),
    -- Hosts the snippet may report from, and the only hosts a click redirect
    -- appends the identification ticket to. Empty means any host.
    allowed_hosts text[] NOT NULL DEFAULT '{}',
    retention_days integer NOT NULL DEFAULT 90
        CHECK (retention_days BETWEEN 7 AND 365),
    updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.website_tracking_settings IS
    'Per-workspace website tracking configuration: snippet site key, consent mode, location precision, retention.';

CREATE TABLE public.website_visitors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    -- The id the snippet keeps in the browser's first-party storage.
    visitor_key text NOT NULL,
    -- Deleting a contact erases their browsing history with them.
    contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
    identified_at timestamptz,
    -- How the browser was tied to the contact: email_link (a click ticket).
    identified_via text,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, visitor_key)
);

CREATE INDEX idx_website_visitors_contact
    ON public.website_visitors USING btree (contact_id)
    WHERE contact_id IS NOT NULL;

CREATE INDEX idx_website_visitors_last_seen
    ON public.website_visitors USING btree (organization_id, last_seen_at);

COMMENT ON TABLE public.website_visitors IS
    'One row per browser the tracking snippet has seen, linked to a contact once an email-link ticket identifies it.';

CREATE TABLE public.website_page_hits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    visitor_id uuid NOT NULL REFERENCES public.website_visitors(id) ON DELETE CASCADE,
    session_key text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    url text NOT NULL,
    path text NOT NULL DEFAULT '',
    title text NOT NULL DEFAULT '',
    referrer text NOT NULL DEFAULT '',
    referrer_domain text NOT NULL DEFAULT '',
    -- First hit of a session: the landing page.
    landing boolean NOT NULL DEFAULT false,
    utm_source text NOT NULL DEFAULT '',
    utm_medium text NOT NULL DEFAULT '',
    utm_campaign text NOT NULL DEFAULT '',
    utm_term text NOT NULL DEFAULT '',
    utm_content text NOT NULL DEFAULT '',
    -- Parsed on the server from the User-Agent header, never from the body.
    device_type text NOT NULL DEFAULT 'unknown'
        CHECK (device_type IN ('desktop', 'mobile', 'tablet', 'unknown')),
    os text NOT NULL DEFAULT '',
    browser text NOT NULL DEFAULT '',
    browser_version text NOT NULL DEFAULT '',
    device_brand text NOT NULL DEFAULT '',
    -- Reported by the browser: cheap, harmless, and not derivable server-side.
    language text NOT NULL DEFAULT '',
    timezone text NOT NULL DEFAULT '',
    screen_width integer NOT NULL DEFAULT 0,
    screen_height integer NOT NULL DEFAULT 0,
    -- Resolved on the server from the request IP, trimmed to the workspace's
    -- location precision. The IP is not stored.
    country_code text NOT NULL DEFAULT '',
    region text NOT NULL DEFAULT '',
    city text NOT NULL DEFAULT ''
);

CREATE INDEX idx_website_page_hits_visitor_recent
    ON public.website_page_hits USING btree (visitor_id, occurred_at DESC);

-- The retention sweep deletes by workspace and age.
CREATE INDEX idx_website_page_hits_org_age
    ON public.website_page_hits USING btree (organization_id, occurred_at);

COMMENT ON TABLE public.website_page_hits IS
    'Counted page views from the tracking snippet, enriched server-side. Pruned per workspace by the retention job.';
