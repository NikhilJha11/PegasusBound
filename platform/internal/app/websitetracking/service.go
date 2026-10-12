// Package websitetracking owns the tracking snippet's settings and the page
// view ingest path. Device and location are derived server-side; a hit reaches
// a contact only through a click ticket. See docs/guides/website-tracking.
package websitetracking

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mileusna/useragent"
	"github.com/pegasusbound/pegasusbound/internal/config"
	"github.com/pegasusbound/pegasusbound/internal/errx"
	"github.com/pegasusbound/pegasusbound/internal/infrastructure/db"
	"github.com/pegasusbound/pegasusbound/internal/infrastructure/pubsub"
	"github.com/pegasusbound/pegasusbound/internal/models"
	"github.com/pegasusbound/pegasusbound/internal/pkg/geo"
	"github.com/pegasusbound/pegasusbound/internal/repository"
)

// Payload caps, mirrored by the tracking service; the backstop here.
const (
	maxURLLen      = 2048
	maxTitleLen    = 512
	maxReferrerLen = 2048
	maxLanguageLen = 32
	maxTimezoneLen = 64
	maxKeyLen      = 64
	minKeyLen      = 16
	maxHosts       = 20
	maxHostLen     = 253
	maxScreenPx    = 20000
)

var (
	// ErrUnknownSite: no workspace owns the key (the edge caches this negatively).
	ErrUnknownSite = errors.New("unknown site key")
	// ErrRejected: well-formed but declined by policy (off, consent, host, bot).
	ErrRejected = errors.New("hit rejected")
	// ErrMalformed is a payload that fails validation.
	ErrMalformed = errors.New("malformed hit")
)

// identifyParam is what the click redirect appends; never stored in a URL.
const identifyParam = "wbly_t"

type Service interface {
	GetSettings(ctx context.Context, orgID uuid.UUID) (*models.WebsiteTrackingSettings, *errx.Error)
	UpdateSettings(ctx context.Context, orgID, userID uuid.UUID, req *models.UpdateWebsiteTrackingSettingsRequest) (*models.WebsiteTrackingSettings, *errx.Error)
	RotateSiteKey(ctx context.Context, orgID, userID uuid.UUID) (*models.WebsiteTrackingSettings, *errx.Error)

	// ShouldIdentify: may the click redirect append the ticket to this destination?
	ShouldIdentify(ctx context.Context, campaignID uuid.UUID, destination string) bool

	// Ingest records one page view; ErrUnknownSite/ErrRejected/ErrMalformed map to statuses.
	Ingest(ctx context.Context, req *models.WebsiteHitRequest) (*models.WebsiteHitResult, error)
}

type service struct {
	repo      repository.WebsiteTrackingRepository
	geo       *geo.Client
	publisher *pubsub.StreamingPublisher
}

func NewService(repo repository.WebsiteTrackingRepository, geoClient *geo.Client, publisher *pubsub.StreamingPublisher) Service {
	return &service{repo: repo, geo: geoClient, publisher: publisher}
}

// newKey is 128 random bits as hex, used for site keys and visitor ids.
func newKey() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return uuid.New().String()
	}
	return hex.EncodeToString(b)
}

func (s *service) GetSettings(ctx context.Context, orgID uuid.UUID) (*models.WebsiteTrackingSettings, *errx.Error) {
	settings, err := s.repo.GetOrCreateSettings(ctx, orgID, newKey())
	if err != nil {
		db.CaptureError(err, "", nil, "websitetracking GetSettings")
		return nil, errx.InternalError()
	}
	settings.TrackingHost = config.TrackingHost()
	return settings, nil
}

func (s *service) UpdateSettings(ctx context.Context, orgID, userID uuid.UUID, req *models.UpdateWebsiteTrackingSettingsRequest) (*models.WebsiteTrackingSettings, *errx.Error) {
	current, xerr := s.GetSettings(ctx, orgID)
	if xerr != nil {
		return nil, xerr
	}
	if req.Enabled != nil {
		current.Enabled = *req.Enabled
	}
	if req.ConsentMode != nil {
		switch *req.ConsentMode {
		case models.WebsiteConsentExplicit, models.WebsiteConsentImplicit:
			current.ConsentMode = *req.ConsentMode
		default:
			return nil, errx.New(errx.BadRequest, "consent_mode must be explicit or implicit")
		}
	}
	if req.LocationPrecision != nil {
		switch *req.LocationPrecision {
		case models.WebsiteLocationNone, models.WebsiteLocationCountry, models.WebsiteLocationCity:
			current.LocationPrecision = *req.LocationPrecision
		default:
			return nil, errx.New(errx.BadRequest, "location_precision must be none, country or city")
		}
	}
	if req.RetentionDays != nil {
		if *req.RetentionDays < models.WebsiteRetentionMinDays || *req.RetentionDays > models.WebsiteRetentionMaxDays {
			return nil, errx.New(errx.BadRequest, "retention_days must be between 7 and 365")
		}
		current.RetentionDays = *req.RetentionDays
	}
	if req.AllowedHosts != nil {
		hosts, ok := normalizeHosts(*req.AllowedHosts)
		if !ok {
			return nil, errx.New(errx.BadRequest, "allowed_hosts must be up to 20 bare hostnames")
		}
		current.AllowedHosts = hosts
	}
	if err := s.repo.UpdateSettings(ctx, orgID, userID, current); err != nil {
		db.CaptureError(err, "", nil, "websitetracking UpdateSettings")
		return nil, errx.InternalError()
	}
	return s.GetSettings(ctx, orgID)
}

func (s *service) RotateSiteKey(ctx context.Context, orgID, userID uuid.UUID) (*models.WebsiteTrackingSettings, *errx.Error) {
	if _, xerr := s.GetSettings(ctx, orgID); xerr != nil {
		return nil, xerr
	}
	if err := s.repo.RotateSiteKey(ctx, orgID, userID, newKey()); err != nil {
		db.CaptureError(err, "", nil, "websitetracking RotateSiteKey")
		return nil, errx.InternalError()
	}
	return s.GetSettings(ctx, orgID)
}

// normalizeHosts reduces pasted URLs and mixed case to unique bare hostnames.
func normalizeHosts(raw []string) ([]string, bool) {
	out := make([]string, 0, len(raw))
	seen := map[string]bool{}
	for _, r := range raw {
		h := config.NormalizeTrackingHost(r)
		if h == "" {
			continue
		}
		if len(h) > maxHostLen || strings.ContainsAny(h, " \t/\\") {
			return nil, false
		}
		if seen[h] {
			continue
		}
		seen[h] = true
		out = append(out, h)
	}
	if len(out) > maxHosts {
		return nil, false
	}
	return out, true
}

// hostAllowed ignores ports; a registered apex covers its subdomains.
func hostAllowed(allowed []string, host string) bool {
	host = hostOnly(host)
	if host == "" {
		return false
	}
	for _, a := range allowed {
		a = hostOnly(a)
		if a == "" {
			continue
		}
		if host == a || strings.HasSuffix(host, "."+a) {
			return true
		}
	}
	return false
}

func hostOnly(h string) string {
	h = strings.ToLower(strings.TrimSpace(h))
	if hp, _, err := net.SplitHostPort(h); err == nil {
		h = hp
	}
	return strings.TrimSuffix(h, ".")
}

func (s *service) ShouldIdentify(ctx context.Context, campaignID uuid.UUID, destination string) bool {
	site, err := s.repo.SiteForCampaign(ctx, campaignID)
	if err != nil || site == nil || !site.Enabled || len(site.AllowedHosts) == 0 {
		return false
	}
	u, perr := url.Parse(destination)
	if perr != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	return hostAllowed(site.AllowedHosts, u.Host)
}

func validKey(k string) bool {
	if len(k) < minKeyLen || len(k) > maxKeyLen {
		return false
	}
	for _, c := range k {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '-', c == '_':
		default:
			return false
		}
	}
	return true
}

func (s *service) Ingest(ctx context.Context, req *models.WebsiteHitRequest) (*models.WebsiteHitResult, error) {
	if req == nil || !validKey(req.SiteKey) || !validKey(req.VisitorKey) || !validKey(req.SessionKey) {
		return nil, ErrMalformed
	}
	if len(req.URL) == 0 || len(req.URL) > maxURLLen || len(req.Title) > maxTitleLen ||
		len(req.Referrer) > maxReferrerLen || len(req.Language) > maxLanguageLen ||
		len(req.Timezone) > maxTimezoneLen ||
		req.ScreenWidth < 0 || req.ScreenHeight < 0 || req.ScreenWidth > maxScreenPx || req.ScreenHeight > maxScreenPx {
		return nil, ErrMalformed
	}
	pageURL, err := url.Parse(req.URL)
	if err != nil || (pageURL.Scheme != "http" && pageURL.Scheme != "https") || pageURL.Host == "" {
		return nil, ErrMalformed
	}

	site, err := s.repo.GetSiteByKey(ctx, req.SiteKey)
	if err != nil {
		db.CaptureError(err, "", nil, "websitetracking GetSiteByKey")
		return nil, err
	}
	if site == nil {
		return nil, ErrUnknownSite
	}
	if !site.Enabled {
		return nil, ErrRejected
	}

	// The server decides whether consent sufficed; a stale snippet cannot downgrade it.
	switch site.ConsentMode {
	case models.WebsiteConsentExplicit:
		if req.Consent != "granted" {
			return nil, ErrRejected
		}
	default:
		if req.Consent != "granted" && req.Consent != "implicit" {
			return nil, ErrRejected
		}
	}

	if len(site.AllowedHosts) > 0 {
		if !hostAllowed(site.AllowedHosts, pageURL.Host) {
			return nil, ErrRejected
		}
		if req.OriginHost != "" && !hostAllowed(site.AllowedHosts, req.OriginHost) {
			return nil, ErrRejected
		}
	}

	ua := useragent.Parse(req.UserAgent)
	if ua.Bot {
		return nil, ErrRejected
	}

	now := time.Now()
	hit := &models.WebsitePageHit{
		SessionKey:     req.SessionKey,
		OccurredAt:     now,
		Title:          strings.TrimSpace(req.Title),
		Landing:        req.Landing,
		Language:       strings.TrimSpace(req.Language),
		Timezone:       strings.TrimSpace(req.Timezone),
		ScreenWidth:    req.ScreenWidth,
		ScreenHeight:   req.ScreenHeight,
		OS:             ua.OS,
		Browser:        ua.Name,
		BrowserVersion: ua.Version,
		DeviceBrand:    ua.Device,
		DeviceType:     deviceType(ua),
	}

	// The ticket never reaches the stored URL.
	q := pageURL.Query()
	hit.UTMSource = clip(q.Get("utm_source"), 256)
	hit.UTMMedium = clip(q.Get("utm_medium"), 256)
	hit.UTMCampaign = clip(q.Get("utm_campaign"), 256)
	hit.UTMTerm = clip(q.Get("utm_term"), 256)
	hit.UTMContent = clip(q.Get("utm_content"), 256)
	if q.Has(identifyParam) {
		q.Del(identifyParam)
		pageURL.RawQuery = q.Encode()
	}
	pageURL.Fragment = ""
	hit.URL = pageURL.String()
	hit.Path = pageURL.Path
	if hit.Path == "" {
		hit.Path = "/"
	}

	if ref := strings.TrimSpace(req.Referrer); ref != "" {
		if ru, rerr := url.Parse(ref); rerr == nil && (ru.Scheme == "http" || ru.Scheme == "https") {
			ru.Fragment = ""
			hit.Referrer = ru.String()
			hit.ReferrerDomain = hostOnly(ru.Host)
		}
	}

	s.locate(req.IP, site.LocationPrecision, hit)

	visitor, err := s.repo.UpsertVisitor(ctx, site.OrganizationID, req.VisitorKey, now)
	if err != nil {
		db.CaptureError(err, "", nil, "websitetracking UpsertVisitor")
		return nil, err
	}

	result := &models.WebsiteHitResult{}
	if req.IdentifyToken != "" {
		if ticket, perr := uuid.Parse(req.IdentifyToken); perr == nil {
			contactID, ticketOrg, ok, terr := s.repo.ContactForTicket(ctx, ticket)
			if terr != nil {
				db.CaptureError(terr, "", nil, "websitetracking ContactForTicket")
			}
			// A ticket from another workspace's campaign proves nothing here.
			if terr == nil && ok && ticketOrg == site.OrganizationID {
				attached, key, aerr := s.attach(ctx, site.OrganizationID, visitor, contactID, now)
				if aerr != nil {
					return nil, aerr
				}
				visitor, result.NewVisitorKey = attached, key
			}
		}
	}

	hit.VisitorID = visitor.ID
	if err := s.repo.InsertHit(ctx, site.OrganizationID, hit); err != nil {
		db.CaptureError(err, "", nil, "websitetracking InsertHit")
		return nil, err
	}

	if visitor.ContactID != nil && s.publisher != nil {
		s.publisher.PublishPageHit(ctx, &pubsub.PageHitEvent{
			OrgID:     site.OrganizationID.String(),
			ContactID: visitor.ContactID.String(),
			URL:       hit.URL,
			Title:     hit.Title,
		})
	}
	return result, nil
}

// errAttach means the browser could not be tied to the ticket's contact
// safely; the hit is dropped rather than stored under the wrong person, and
// the edge retries it.
var errAttach = errors.New("visitor attach failed")

// attach ties the browser to the ticket's contact. An anonymous row is
// claimed with a guarded update; if a concurrent hit won that race for a
// different contact, or the row already belonged to someone else, the browser
// is split onto a fresh row. Any failure on the way returns errAttach so the
// caller never inserts under a row it does not own.
func (s *service) attach(ctx context.Context, orgID uuid.UUID, visitor *models.WebsiteVisitor, contactID uuid.UUID, now time.Time) (*models.WebsiteVisitor, string, error) {
	if visitor.ContactID == nil {
		updated, err := s.repo.IdentifyVisitor(ctx, visitor.ID, contactID, "email_link", now)
		if err != nil {
			db.CaptureError(err, "", nil, "websitetracking IdentifyVisitor")
			return nil, "", errAttach
		}
		if updated {
			visitor.ContactID = &contactID
			return visitor, "", nil
		}
		current, err := s.repo.GetVisitorByID(ctx, visitor.ID)
		if err != nil {
			db.CaptureError(err, "", nil, "websitetracking GetVisitorByID")
			return nil, "", errAttach
		}
		visitor = current
	}
	if visitor.ContactID != nil && *visitor.ContactID == contactID {
		return visitor, "", nil
	}
	fresh, err := s.repo.CreateVisitor(ctx, orgID, newKey(), contactID, "email_link", now)
	if err != nil {
		db.CaptureError(err, "", nil, "websitetracking CreateVisitor")
		return nil, "", errAttach
	}
	return fresh, fresh.VisitorKey, nil
}

// locate fills location from the request IP at the workspace's precision;
// best-effort, and the IP goes no further than this call.
func (s *service) locate(ip string, precision models.WebsiteLocationPrecision, hit *models.WebsitePageHit) {
	if precision == models.WebsiteLocationNone || s.geo == nil || ip == "" {
		return
	}
	addr, err := netip.ParseAddr(strings.TrimSpace(ip))
	if err != nil || addr.IsPrivate() || addr.IsLoopback() {
		return
	}
	info, err := s.geo.Lookup(addr)
	if err != nil || info == nil {
		return
	}
	hit.CountryCode = info.CountryCode
	if precision == models.WebsiteLocationCity {
		hit.Region = info.Region
		if info.City != "Unknown" {
			hit.City = info.City
		}
	}
}

func deviceType(ua useragent.UserAgent) string {
	switch {
	case ua.Tablet:
		return "tablet"
	case ua.Mobile:
		return "mobile"
	case ua.Desktop:
		return "desktop"
	default:
		return "unknown"
	}
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		return s[:n]
	}
	return s
}
