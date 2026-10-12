package models

import (
	"time"

	"github.com/google/uuid"
)

// Website visitor tracking (issue #255, section 13): the snippet a workspace
// installs on its own site, and the page views it reports.

// WebsiteConsentMode says when the snippet may record anything.
type WebsiteConsentMode string

const (
	// WebsiteConsentExplicit records nothing until the page calls
	// pegasusbound('consent', 'granted'). The default, because the product sells into
	// jurisdictions where device and location data need a prior opt-in.
	WebsiteConsentExplicit WebsiteConsentMode = "explicit"
	// WebsiteConsentImplicit records on load. The workspace asserts its own
	// lawful basis by choosing it.
	WebsiteConsentImplicit WebsiteConsentMode = "implicit"
)

// WebsiteLocationPrecision is how much of the IP-derived location is kept.
type WebsiteLocationPrecision string

const (
	WebsiteLocationNone    WebsiteLocationPrecision = "none"
	WebsiteLocationCountry WebsiteLocationPrecision = "country"
	WebsiteLocationCity    WebsiteLocationPrecision = "city"
)

const (
	WebsiteRetentionMinDays     = 7
	WebsiteRetentionMaxDays     = 365
	WebsiteRetentionDefaultDays = 90
)

// WebsiteTrackingSettings is a workspace's tracking configuration. Created on
// first read with tracking disabled, so every workspace has a site key to show
// but nothing is accepted until someone turns it on.
type WebsiteTrackingSettings struct {
	OrganizationID    uuid.UUID                `json:"organization_id"`
	Enabled           bool                     `json:"enabled"`
	SiteKey           string                   `json:"site_key"`
	ConsentMode       WebsiteConsentMode       `json:"consent_mode"`
	LocationPrecision WebsiteLocationPrecision `json:"location_precision"`
	AllowedHosts      []string                 `json:"allowed_hosts"`
	RetentionDays     int                      `json:"retention_days"`
	UpdatedAt         time.Time                `json:"updated_at"`
	// TrackingHost is the deployment's tracking host (TRACKING_DOMAIN), so the
	// dashboard can render the exact snippet. Empty when the install has none.
	TrackingHost string `json:"tracking_host"`
}

// UpdateWebsiteTrackingSettingsRequest is the PATCH body. Every field is
// optional; absent fields keep their value.
type UpdateWebsiteTrackingSettingsRequest struct {
	Enabled           *bool                     `json:"enabled"`
	ConsentMode       *WebsiteConsentMode       `json:"consent_mode"`
	LocationPrecision *WebsiteLocationPrecision `json:"location_precision"`
	AllowedHosts      *[]string                 `json:"allowed_hosts"`
	RetentionDays     *int                      `json:"retention_days"`
}

// WebsiteHitRequest is what the tracking service forwards to the backend for
// one page view: the snippet's payload plus the request facts only the edge
// saw. Device and location are derived here from UserAgent and IP; nothing
// about them is trusted from the snippet.
type WebsiteHitRequest struct {
	SiteKey    string `json:"site_key"`
	VisitorKey string `json:"visitor_key"`
	SessionKey string `json:"session_key"`
	// Consent is what the snippet believes: "granted" after an explicit
	// opt-in, "implicit" when the snippet runs in implicit mode. The
	// workspace's configured mode decides whether that is enough.
	Consent string `json:"consent"`
	// IdentifyToken is the click ticket the redirect appended to the landing
	// URL. It is the only way a hit reaches a contact.
	IdentifyToken string `json:"identify_token"`

	URL          string `json:"url"`
	Title        string `json:"title"`
	Referrer     string `json:"referrer"`
	Language     string `json:"language"`
	Timezone     string `json:"timezone"`
	ScreenWidth  int    `json:"screen_width"`
	ScreenHeight int    `json:"screen_height"`
	// Landing marks the first view of a session, as judged by the snippet.
	Landing bool `json:"landing"`

	UserAgent  string `json:"user_agent"`
	IP         string `json:"ip"`
	OriginHost string `json:"origin_host"`
}

// WebsiteHitResult tells the tracking service what to answer the browser.
type WebsiteHitResult struct {
	// NewVisitorKey is set when the browser must adopt a fresh visitor id:
	// the ticket named a different contact than the one already tied to
	// this browser, so the record was split rather than merged.
	NewVisitorKey string `json:"new_visitor_key,omitempty"`
}

// WebsitePageHit is one counted page view as stored and as shown in the
// contact timeline.
type WebsitePageHit struct {
	ID             uuid.UUID `json:"id"`
	VisitorID      uuid.UUID `json:"visitor_id"`
	SessionKey     string    `json:"session_key"`
	OccurredAt     time.Time `json:"occurred_at"`
	URL            string    `json:"url"`
	Path           string    `json:"path"`
	Title          string    `json:"title"`
	Referrer       string    `json:"referrer"`
	ReferrerDomain string    `json:"referrer_domain"`
	Landing        bool      `json:"landing"`
	UTMSource      string    `json:"utm_source"`
	UTMMedium      string    `json:"utm_medium"`
	UTMCampaign    string    `json:"utm_campaign"`
	UTMTerm        string    `json:"utm_term"`
	UTMContent     string    `json:"utm_content"`
	DeviceType     string    `json:"device_type"`
	OS             string    `json:"os"`
	Browser        string    `json:"browser"`
	BrowserVersion string    `json:"browser_version"`
	DeviceBrand    string    `json:"device_brand"`
	Language       string    `json:"language"`
	Timezone       string    `json:"timezone"`
	ScreenWidth    int       `json:"screen_width"`
	ScreenHeight   int       `json:"screen_height"`
	CountryCode    string    `json:"country_code"`
	Region         string    `json:"region"`
	City           string    `json:"city"`
}

// WebsiteSite is what the ingest path needs to know about a site key.
type WebsiteSite struct {
	OrganizationID    uuid.UUID
	Enabled           bool
	ConsentMode       WebsiteConsentMode
	LocationPrecision WebsiteLocationPrecision
	AllowedHosts      []string
}

// WebsiteVisitor is one browser the snippet has seen.
type WebsiteVisitor struct {
	ID             uuid.UUID
	OrganizationID uuid.UUID
	VisitorKey     string
	ContactID      *uuid.UUID
	IdentifiedAt   *time.Time
	IdentifiedVia  string
}

// WebsiteTrackingRetentionCutoff is one workspace's prune boundary.
type WebsiteTrackingRetentionCutoff struct {
	OrganizationID uuid.UUID
	Before         time.Time
}
