package validate

import (
	"testing"
	"time"
)

// Issue #171: the dashboard's date picker sends midnight in the user's
// timezone, so "today" is always a few hours in the past at submit time and
// must be accepted as "start now".
func TestCampaignStartDateAcceptsToday(t *testing.T) {
	localMidnight := time.Now().Truncate(24 * time.Hour)
	if err := CampaignStartDate(localMidnight); err != nil {
		t.Fatalf("today at midnight should be accepted, got %v", err)
	}
	// Worst-case timezone offset: a "today" pick is never more than 24h old.
	if err := CampaignStartDate(time.Now().Add(-23 * time.Hour)); err != nil {
		t.Fatalf("a date within the last 24h should be accepted, got %v", err)
	}
}

func TestCampaignStartDateRejectsPast(t *testing.T) {
	if err := CampaignStartDate(time.Now().Add(-48 * time.Hour)); err == nil {
		t.Fatal("a date two days in the past should be rejected")
	}
}

func TestCampaignStartDateAcceptsFuture(t *testing.T) {
	if err := CampaignStartDate(time.Now().Add(72 * time.Hour)); err != nil {
		t.Fatalf("a future date should be accepted, got %v", err)
	}
}
