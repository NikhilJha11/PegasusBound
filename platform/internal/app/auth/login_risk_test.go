package auth

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/pegasusbound/pegasusbound/internal/app/authrisk"
	"github.com/pegasusbound/pegasusbound/internal/models"
	"github.com/pegasusbound/pegasusbound/internal/repository"
)

type stubLoginHistory struct {
	recorded []repository.LoginRecord
	last     *repository.LoginRecord
}

func (s *stubLoginHistory) RecordLogin(ctx context.Context, userID uuid.UUID, rec repository.LoginRecord) error {
	s.recorded = append(s.recorded, rec)
	return nil
}

func (s *stubLoginHistory) LastLogin(ctx context.Context, userID uuid.UUID) (*repository.LoginRecord, error) {
	return s.last, nil
}

func (s *stubLoginHistory) CountFlaggedSince(ctx context.Context, userID uuid.UUID, since time.Time) (int, error) {
	return 0, nil
}

// The emailed code is confirmed by a second request, which can arrive from a
// different address and after more history has landed. Re-assessing there would
// store the challenged sign-in as clean and lose it from the repeat count.
func TestConfirmRecordsTheVerdictThatIssuedTheChallenge(t *testing.T) {
	hist := &stubLoginHistory{}
	s := &authService{loginHistory: hist}

	sess := &models.LoginSession{AnomalyReason: "sign-in 6000 km from the previous one 1h earlier"}
	s.recordLogin(context.Background(), uuid.New(), "203.0.113.9", "curl", *challengeVerdict(sess))

	if len(hist.recorded) != 1 {
		t.Fatalf("recorded %d sign-ins, want 1", len(hist.recorded))
	}
	got := hist.recorded[0]
	if !got.Flagged || got.FlagReason != sess.AnomalyReason {
		t.Fatalf("stored flagged=%v reason=%q, want the challenge's own verdict", got.Flagged, got.FlagReason)
	}
}

// A login that was never challenged must not acquire a reason it never had.
func TestUnchallengedLoginRecordsClean(t *testing.T) {
	hist := &stubLoginHistory{}
	s := &authService{loginHistory: hist}

	s.recordLogin(context.Background(), uuid.New(), "203.0.113.9", "curl", authrisk.Verdict{})

	if hist.recorded[0].Flagged || hist.recorded[0].FlagReason != "" {
		t.Fatalf("clean sign-in stored as %+v", hist.recorded[0])
	}
}
