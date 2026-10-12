package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pegasusbound/pegasusbound/internal/models"
)

// WebsiteTrackingRepository stores tracking settings, the browsers the snippet
// has seen, and their page views. Only the internal ingest path writes hits.
type WebsiteTrackingRepository interface {
	GetOrCreateSettings(ctx context.Context, orgID uuid.UUID, siteKey string) (*models.WebsiteTrackingSettings, error)
	UpdateSettings(ctx context.Context, orgID, updatedBy uuid.UUID, s *models.WebsiteTrackingSettings) error
	RotateSiteKey(ctx context.Context, orgID, updatedBy uuid.UUID, siteKey string) error

	GetSiteByKey(ctx context.Context, siteKey string) (*models.WebsiteSite, error)
	SiteForCampaign(ctx context.Context, campaignID uuid.UUID) (*models.WebsiteSite, error)
	// ContactForTicket resolves a click ticket to the contact it was mailed to
	// and the workspace that owns the campaign. ok is false for an unknown
	// ticket or one whose task has no contact.
	ContactForTicket(ctx context.Context, ticketID uuid.UUID) (contactID, orgID uuid.UUID, ok bool, err error)

	UpsertVisitor(ctx context.Context, orgID uuid.UUID, visitorKey string, seenAt time.Time) (*models.WebsiteVisitor, error)
	CreateVisitor(ctx context.Context, orgID uuid.UUID, visitorKey string, contactID uuid.UUID, via string, at time.Time) (*models.WebsiteVisitor, error)
	// IdentifyVisitor ties an anonymous browser to a contact. false when the
	// row was already tied (possibly by a concurrent hit) and nothing changed.
	IdentifyVisitor(ctx context.Context, visitorID, contactID uuid.UUID, via string, at time.Time) (bool, error)
	GetVisitorByID(ctx context.Context, visitorID uuid.UUID) (*models.WebsiteVisitor, error)
	InsertHit(ctx context.Context, orgID uuid.UUID, hit *models.WebsitePageHit) error

	ListHitsForContact(ctx context.Context, orgID, contactID uuid.UUID, before time.Time, limit int) ([]models.WebsitePageHit, error)

	RetentionCutoffs(ctx context.Context, now time.Time) ([]models.WebsiteTrackingRetentionCutoff, error)
	PruneBefore(ctx context.Context, orgID uuid.UUID, before time.Time) (int64, error)
}

type websiteTrackingRepository struct {
	db *pgxpool.Pool
}

func NewWebsiteTrackingRepository(db *pgxpool.Pool) WebsiteTrackingRepository {
	return &websiteTrackingRepository{db: db}
}

const websiteSettingsColumns = `organization_id, enabled, site_key, consent_mode, location_precision, allowed_hosts, retention_days, updated_at`

func scanWebsiteSettings(row pgx.Row) (*models.WebsiteTrackingSettings, error) {
	var s models.WebsiteTrackingSettings
	if err := row.Scan(&s.OrganizationID, &s.Enabled, &s.SiteKey, &s.ConsentMode, &s.LocationPrecision, &s.AllowedHosts, &s.RetentionDays, &s.UpdatedAt); err != nil {
		return nil, err
	}
	if s.AllowedHosts == nil {
		s.AllowedHosts = []string{}
	}
	return &s, nil
}

// GetOrCreateSettings creates a disabled row with the given site key on first read.
func (r *websiteTrackingRepository) GetOrCreateSettings(ctx context.Context, orgID uuid.UUID, siteKey string) (*models.WebsiteTrackingSettings, error) {
	_, err := r.db.Exec(ctx, `
		INSERT INTO website_tracking_settings (organization_id, site_key)
		VALUES ($1, $2)
		ON CONFLICT (organization_id) DO NOTHING
	`, orgID, siteKey)
	if err != nil {
		return nil, err
	}
	return scanWebsiteSettings(r.db.QueryRow(ctx,
		`SELECT `+websiteSettingsColumns+` FROM website_tracking_settings WHERE organization_id = $1`, orgID))
}

func (r *websiteTrackingRepository) UpdateSettings(ctx context.Context, orgID, updatedBy uuid.UUID, s *models.WebsiteTrackingSettings) error {
	_, err := r.db.Exec(ctx, `
		UPDATE website_tracking_settings
		SET enabled = $2, consent_mode = $3, location_precision = $4, allowed_hosts = $5,
		    retention_days = $6, updated_by = $7, updated_at = now()
		WHERE organization_id = $1
	`, orgID, s.Enabled, s.ConsentMode, s.LocationPrecision, s.AllowedHosts, s.RetentionDays, updatedBy)
	return err
}

func (r *websiteTrackingRepository) RotateSiteKey(ctx context.Context, orgID, updatedBy uuid.UUID, siteKey string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE website_tracking_settings
		SET site_key = $2, updated_by = $3, updated_at = now()
		WHERE organization_id = $1
	`, orgID, siteKey, updatedBy)
	return err
}

func scanWebsiteSite(row pgx.Row) (*models.WebsiteSite, error) {
	var s models.WebsiteSite
	err := row.Scan(&s.OrganizationID, &s.Enabled, &s.ConsentMode, &s.LocationPrecision, &s.AllowedHosts)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// GetSiteByKey is the ingest lookup. nil, nil when the key is unknown.
func (r *websiteTrackingRepository) GetSiteByKey(ctx context.Context, siteKey string) (*models.WebsiteSite, error) {
	return scanWebsiteSite(r.db.QueryRow(ctx, `
		SELECT organization_id, enabled, consent_mode, location_precision, allowed_hosts
		FROM website_tracking_settings
		WHERE site_key = $1
	`, siteKey))
}

// SiteForCampaign backs the click redirect's identify decision. nil, nil when unset.
func (r *websiteTrackingRepository) SiteForCampaign(ctx context.Context, campaignID uuid.UUID) (*models.WebsiteSite, error) {
	return scanWebsiteSite(r.db.QueryRow(ctx, `
		SELECT s.organization_id, s.enabled, s.consent_mode, s.location_precision, s.allowed_hosts
		FROM campaigns c
		JOIN website_tracking_settings s ON s.organization_id = c.organization_id
		WHERE c.id = $1
	`, campaignID))
}

func (r *websiteTrackingRepository) ContactForTicket(ctx context.Context, ticketID uuid.UUID) (uuid.UUID, uuid.UUID, bool, error) {
	var contactID, orgID *uuid.UUID
	err := r.db.QueryRow(ctx, `
		SELECT ct.contact_id, c.organization_id
		FROM tracked_links tl
		JOIN campaign_tasks ct ON ct.task_id = tl.task_id
		JOIN campaigns c ON c.id = tl.campaign_id
		WHERE tl.id = $1
	`, ticketID).Scan(&contactID, &orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, uuid.Nil, false, err
	}
	if contactID == nil || orgID == nil {
		return uuid.Nil, uuid.Nil, false, nil
	}
	return *contactID, *orgID, true, nil
}

const websiteVisitorColumns = `id, organization_id, visitor_key, contact_id, identified_at, COALESCE(identified_via, '')`

func scanWebsiteVisitor(row pgx.Row) (*models.WebsiteVisitor, error) {
	var v models.WebsiteVisitor
	if err := row.Scan(&v.ID, &v.OrganizationID, &v.VisitorKey, &v.ContactID, &v.IdentifiedAt, &v.IdentifiedVia); err != nil {
		return nil, err
	}
	return &v, nil
}

// UpsertVisitor returns the browser's row, creating it on first sight and
// bumping last_seen_at otherwise.
func (r *websiteTrackingRepository) UpsertVisitor(ctx context.Context, orgID uuid.UUID, visitorKey string, seenAt time.Time) (*models.WebsiteVisitor, error) {
	return scanWebsiteVisitor(r.db.QueryRow(ctx, `
		INSERT INTO website_visitors (organization_id, visitor_key, first_seen_at, last_seen_at)
		VALUES ($1, $2, $3, $3)
		ON CONFLICT (organization_id, visitor_key)
		DO UPDATE SET last_seen_at = GREATEST(website_visitors.last_seen_at, EXCLUDED.last_seen_at)
		RETURNING `+websiteVisitorColumns, orgID, visitorKey, seenAt))
}

// CreateVisitor opens a fresh, already-identified browser record (the split
// path: a ticket named a different contact than the one tied to the browser).
func (r *websiteTrackingRepository) CreateVisitor(ctx context.Context, orgID uuid.UUID, visitorKey string, contactID uuid.UUID, via string, at time.Time) (*models.WebsiteVisitor, error) {
	return scanWebsiteVisitor(r.db.QueryRow(ctx, `
		INSERT INTO website_visitors (organization_id, visitor_key, contact_id, identified_at, identified_via, first_seen_at, last_seen_at)
		VALUES ($1, $2, $3, $4, $5, $4, $4)
		RETURNING `+websiteVisitorColumns, orgID, visitorKey, contactID, at, via))
}

func (r *websiteTrackingRepository) IdentifyVisitor(ctx context.Context, visitorID, contactID uuid.UUID, via string, at time.Time) (bool, error) {
	tag, err := r.db.Exec(ctx, `
		UPDATE website_visitors
		SET contact_id = $2, identified_at = $3, identified_via = $4
		WHERE id = $1 AND contact_id IS NULL
	`, visitorID, contactID, at, via)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (r *websiteTrackingRepository) GetVisitorByID(ctx context.Context, visitorID uuid.UUID) (*models.WebsiteVisitor, error) {
	return scanWebsiteVisitor(r.db.QueryRow(ctx,
		`SELECT `+websiteVisitorColumns+` FROM website_visitors WHERE id = $1`, visitorID))
}

func (r *websiteTrackingRepository) InsertHit(ctx context.Context, orgID uuid.UUID, h *models.WebsitePageHit) error {
	if h.ID == uuid.Nil {
		h.ID = uuid.New()
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO website_page_hits (
			id, organization_id, visitor_id, session_key, occurred_at,
			url, path, title, referrer, referrer_domain, landing,
			utm_source, utm_medium, utm_campaign, utm_term, utm_content,
			device_type, os, browser, browser_version, device_brand,
			language, timezone, screen_width, screen_height,
			country_code, region, city
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8, $9, $10, $11,
			$12, $13, $14, $15, $16,
			$17, $18, $19, $20, $21,
			$22, $23, $24, $25,
			$26, $27, $28
		)
	`,
		h.ID, orgID, h.VisitorID, h.SessionKey, h.OccurredAt,
		h.URL, h.Path, h.Title, h.Referrer, h.ReferrerDomain, h.Landing,
		h.UTMSource, h.UTMMedium, h.UTMCampaign, h.UTMTerm, h.UTMContent,
		h.DeviceType, h.OS, h.Browser, h.BrowserVersion, h.DeviceBrand,
		h.Language, h.Timezone, h.ScreenWidth, h.ScreenHeight,
		h.CountryCode, h.Region, h.City,
	)
	return err
}

// ListHitsForContact: every view from any browser tied to the contact, newest first.
func (r *websiteTrackingRepository) ListHitsForContact(ctx context.Context, orgID, contactID uuid.UUID, before time.Time, limit int) ([]models.WebsitePageHit, error) {
	rows, err := r.db.Query(ctx, `
		SELECT h.id, h.visitor_id, h.session_key, h.occurred_at,
		       h.url, h.path, h.title, h.referrer, h.referrer_domain, h.landing,
		       h.utm_source, h.utm_medium, h.utm_campaign, h.utm_term, h.utm_content,
		       h.device_type, h.os, h.browser, h.browser_version, h.device_brand,
		       h.language, h.timezone, h.screen_width, h.screen_height,
		       h.country_code, h.region, h.city
		FROM website_page_hits h
		WHERE h.organization_id = $1
		  AND h.visitor_id IN (SELECT id FROM website_visitors WHERE contact_id = $2)
		  AND h.occurred_at < $3
		ORDER BY h.occurred_at DESC
		LIMIT $4
	`, orgID, contactID, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]models.WebsitePageHit, 0, limit)
	for rows.Next() {
		var h models.WebsitePageHit
		if err := rows.Scan(
			&h.ID, &h.VisitorID, &h.SessionKey, &h.OccurredAt,
			&h.URL, &h.Path, &h.Title, &h.Referrer, &h.ReferrerDomain, &h.Landing,
			&h.UTMSource, &h.UTMMedium, &h.UTMCampaign, &h.UTMTerm, &h.UTMContent,
			&h.DeviceType, &h.OS, &h.Browser, &h.BrowserVersion, &h.DeviceBrand,
			&h.Language, &h.Timezone, &h.ScreenWidth, &h.ScreenHeight,
			&h.CountryCode, &h.Region, &h.City,
		); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// RetentionCutoffs lists every workspace's prune boundary from its own window.
func (r *websiteTrackingRepository) RetentionCutoffs(ctx context.Context, now time.Time) ([]models.WebsiteTrackingRetentionCutoff, error) {
	rows, err := r.db.Query(ctx, `
		SELECT organization_id, $1::timestamptz - make_interval(days => retention_days)
		FROM website_tracking_settings
	`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.WebsiteTrackingRetentionCutoff
	for rows.Next() {
		var c models.WebsiteTrackingRetentionCutoff
		if err := rows.Scan(&c.OrganizationID, &c.Before); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// PruneBefore drops old page views, then browser rows with nothing left.
func (r *websiteTrackingRepository) PruneBefore(ctx context.Context, orgID uuid.UUID, before time.Time) (int64, error) {
	tag, err := r.db.Exec(ctx, `
		DELETE FROM website_page_hits WHERE organization_id = $1 AND occurred_at < $2
	`, orgID, before)
	if err != nil {
		return 0, err
	}
	_, err = r.db.Exec(ctx, `
		DELETE FROM website_visitors v
		WHERE v.organization_id = $1
		  AND v.last_seen_at < $2
		  AND NOT EXISTS (SELECT 1 FROM website_page_hits h WHERE h.visitor_id = v.id)
	`, orgID, before)
	return tag.RowsAffected(), err
}
