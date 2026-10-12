package tasks

import (
	"testing"

	"github.com/pegasusbound/pegasusbound/internal/models"
)

const installHost = "t.pegasusbound.test"

func TestResolveTrackingHostFallsBackToTheInstall(t *testing.T) {
	host, ignored := resolveTrackingHost(installHost, &models.Email{}, &models.Campaign{})
	if host != installHost {
		t.Fatalf("got %q", host)
	}
	if len(ignored) != 0 {
		t.Fatalf("nothing was configured, so nothing was ignored: %+v", ignored)
	}
}

func TestResolveTrackingHostUsesVerifiedMailboxDomain(t *testing.T) {
	account := &models.Email{TrackingDomain: "track.acme.com", TrackingDomainVerified: true}
	host, ignored := resolveTrackingHost(installHost, account, &models.Campaign{})
	if host != "track.acme.com" || len(ignored) != 0 {
		t.Fatalf("got %q / %+v", host, ignored)
	}
}

// The mailbox domain used to be honored whether or not it verified, so a
// mailbox pointed at a name that did not resolve shipped emails in which every
// link was dead and no open could record.
func TestResolveTrackingHostIgnoresUnverifiedMailboxDomain(t *testing.T) {
	account := &models.Email{TrackingDomain: "track.acme.com"}
	host, ignored := resolveTrackingHost(installHost, account, &models.Campaign{})
	if host != installHost {
		t.Fatalf("expected the shared host, got %q", host)
	}
	if len(ignored) != 1 || ignored[0].Scope != "mailbox" || ignored[0].Domain != "track.acme.com" {
		t.Fatalf("the send log has to say why: %+v", ignored)
	}
}

func TestResolveTrackingHostVerifiedCampaignOverrideWins(t *testing.T) {
	account := &models.Email{TrackingDomain: "track.acme.com", TrackingDomainVerified: true}
	campaign := &models.Campaign{TrackingDomain: "go.acme.com", TrackingDomainVerified: true}
	host, ignored := resolveTrackingHost(installHost, account, campaign)
	if host != "go.acme.com" || len(ignored) != 0 {
		t.Fatalf("got %q / %+v", host, ignored)
	}
}

func TestResolveTrackingHostUnverifiedCampaignFallsBackToTheMailbox(t *testing.T) {
	account := &models.Email{TrackingDomain: "track.acme.com", TrackingDomainVerified: true}
	campaign := &models.Campaign{TrackingDomain: "go.acme.com"}
	host, ignored := resolveTrackingHost(installHost, account, campaign)
	if host != "track.acme.com" {
		t.Fatalf("expected the verified mailbox domain, got %q", host)
	}
	if len(ignored) != 1 || ignored[0].Scope != "campaign" {
		t.Fatalf("expected one campaign-scoped note: %+v", ignored)
	}
}

// Neither override verified: the shared host, and both logged.
func TestResolveTrackingHostBothUnverified(t *testing.T) {
	account := &models.Email{TrackingDomain: "track.acme.com"}
	campaign := &models.Campaign{TrackingDomain: "go.acme.com"}
	host, ignored := resolveTrackingHost(installHost, account, campaign)
	if host != installHost || len(ignored) != 2 {
		t.Fatalf("got %q / %+v", host, ignored)
	}
}

// No tracking host anywhere: the caller gets "", and the template helpers turn
// that into untracked mail rather than links to a host that does not exist.
func TestResolveTrackingHostEmptyInstall(t *testing.T) {
	host, _ := resolveTrackingHost("", &models.Email{TrackingDomain: "track.acme.com"}, &models.Campaign{})
	if host != "" {
		t.Fatalf("got %q", host)
	}
}
