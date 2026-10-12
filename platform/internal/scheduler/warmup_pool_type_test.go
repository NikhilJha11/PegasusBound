package scheduler

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/pegasusbound/pegasusbound/internal/models"
	"github.com/pegasusbound/pegasusbound/internal/repository"
)

type poolTypeRiskRepo struct {
	repository.OrgRiskRepository
	states map[uuid.UUID]models.OrgRiskState
	err    error
}

func (r *poolTypeRiskRepo) GetOrgRiskStates(_ context.Context, _ []uuid.UUID) (map[uuid.UUID]models.OrgRiskState, error) {
	return r.states, r.err
}

// The recipient-capacity count has to be taken against the pool the mailbox
// will actually send into, or a restricted mailbox sizes its day off the
// premium pool it is no longer in (issue #242).
func TestWarmupPoolTypeForAccountFollowsTheOrganizationsPosture(t *testing.T) {
	org := uuid.New()
	account := &models.Email{ID: uuid.New(), OrganizationID: &org, WarmupPoolType: "premium"}

	for _, tc := range []struct {
		name string
		risk *poolTypeRiskRepo
		want string
	}{
		{"restricted", &poolTypeRiskRepo{states: map[uuid.UUID]models.OrgRiskState{org: models.OrgRiskRestricted}}, "free"},
		{"suspended", &poolTypeRiskRepo{states: map[uuid.UUID]models.OrgRiskState{org: models.OrgRiskSuspended}}, "free"},
		{"watch", &poolTypeRiskRepo{states: map[uuid.UUID]models.OrgRiskState{org: models.OrgRiskWatch}}, "premium"},
		{"trusted", &poolTypeRiskRepo{states: map[uuid.UUID]models.OrgRiskState{org: models.OrgRiskTrusted}}, "premium"},
		{"lookup failure fails open", &poolTypeRiskRepo{err: errors.New("connection reset by peer")}, "premium"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &schedulerService{orgRiskRepo: tc.risk}
			if got := s.warmupPoolTypeForAccount(context.Background(), account); got != tc.want {
				t.Fatalf("resolved %q, want %q", got, tc.want)
			}
		})
	}
}

// Without the risk repository wired the stored tier stands, and a mailbox with
// no tier recorded keeps the historical premium default.
func TestWarmupPoolTypeForAccountWithoutRiskWired(t *testing.T) {
	s := &schedulerService{}
	org := uuid.New()

	if got := s.warmupPoolTypeForAccount(context.Background(), &models.Email{OrganizationID: &org, WarmupPoolType: "free"}); got != "free" {
		t.Fatalf("resolved %q, want free", got)
	}
	if got := s.warmupPoolTypeForAccount(context.Background(), &models.Email{OrganizationID: &org}); got != "premium" {
		t.Fatalf("resolved %q, want premium", got)
	}
	if got := s.warmupPoolTypeForAccount(context.Background(), nil); got != "premium" {
		t.Fatalf("nil account resolved %q, want premium", got)
	}
}
