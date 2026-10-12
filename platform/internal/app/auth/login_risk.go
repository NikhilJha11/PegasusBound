package auth

import (
	"context"
	"net/netip"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/pegasusbound/pegasusbound/internal/app/authrisk"
	"github.com/pegasusbound/pegasusbound/internal/app/orgrisk"
	"github.com/pegasusbound/pegasusbound/internal/repository"
)

// repeatFlagWindow and repeatFlagCount describe a PATTERN rather than one odd
// trip. A single anomalous sign-in is challenged; several inside a fortnight
// are worth recording against the workspace.
const (
	repeatFlagWindow = 14 * 24 * time.Hour
	repeatFlagCount  = 3
)

// assessLogin compares this sign-in against the account's most recent one.
// Every failure path answers "not anomalous": a false challenge locks a real
// user out of their own account, which is worse than a missed signal.
func (s *authService) assessLogin(ctx context.Context, userID uuid.UUID, ipaddr string) authrisk.Verdict {
	if s.loginHistory == nil {
		return authrisk.Verdict{}
	}
	prev, err := s.loginHistory.LastLogin(ctx, userID)
	if err != nil {
		return authrisk.Verdict{}
	}
	var from *authrisk.Place
	if prev != nil {
		from = &authrisk.Place{
			CountryCode: prev.CountryCode,
			Latitude:    prev.Latitude,
			Longitude:   prev.Longitude,
			At:          prev.CreatedAt,
		}
	}
	return authrisk.Assess(from, s.placeOf(ipaddr, time.Now()))
}

// placeOf resolves an address to a location. An unknown address yields a Place
// with no position, which Assess declines to judge.
func (s *authService) placeOf(ipaddr string, at time.Time) authrisk.Place {
	place := authrisk.Place{At: at}
	addr, err := netip.ParseAddr(strings.TrimSpace(ipaddr))
	if err != nil || s.geo == nil {
		return place
	}
	info, lerr := s.geo.Lookup(addr)
	if lerr != nil || info == nil {
		return place
	}
	place.CountryCode = info.CountryCode
	if info.HasPosition() {
		place.Latitude, place.Longitude = info.Latitude, info.Longitude
	}
	return place
}

// recordLogin appends the sign-in to the comparison window and, when anomalies
// have become a pattern, files it against the workspace's posture.
func (s *authService) recordLogin(ctx context.Context, userID uuid.UUID, ipaddr, userAgent string, verdict authrisk.Verdict) {
	if s.loginHistory == nil {
		return
	}
	place := s.placeOf(ipaddr, time.Now())
	rec := repository.LoginRecord{
		IP:          ipaddr,
		UserAgent:   userAgent,
		CountryCode: place.CountryCode,
		Latitude:    place.Latitude,
		Longitude:   place.Longitude,
		Flagged:     verdict.Flagged,
		FlagReason:  verdict.Reason,
	}
	if err := s.loginHistory.RecordLogin(ctx, userID, rec); err != nil {
		log.Warn().Err(err).Str("user_id", userID.String()).Msg("could not record the sign-in location")
		return
	}
	if !verdict.Flagged {
		return
	}

	log.Info().Str("user_id", userID.String()).Str("reason", verdict.Reason).
		Msg("anomalous sign-in challenged")

	// One odd trip is not a pattern; several are.
	n, err := s.loginHistory.CountFlaggedSince(ctx, userID, time.Now().Add(-repeatFlagWindow))
	if err != nil || n < repeatFlagCount || s.orgRisk == nil || s.organizationService == nil {
		return
	}
	org, oerr := s.organizationService.GetUserDefaultOrganization(ctx, userID)
	if oerr != nil || org == nil {
		return
	}
	orgID := org.ID
	if _, rerr := s.orgRisk.RecordSignal(ctx, orgID, orgrisk.Signal{
		Key:    "login_anomalies",
		Weight: 20,
		Detail: "repeated sign-ins from implausible locations",
		// Circumstantial: a travelling operator or a VPN reads the same way.
		Class: orgrisk.ClassCircumstantial,
		TTL:   orgrisk.DefaultSignalTTL,
	}); rerr != nil {
		log.Warn().Str("organization_id", orgID.String()).Msg("could not record the sign-in anomaly signal")
	}
}
