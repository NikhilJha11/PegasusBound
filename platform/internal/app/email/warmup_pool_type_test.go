package email

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

// A mailbox connected under a restricted workspace joins the free pool, not the
// tier its worker assignment wrote (issue #242).
func TestResolveWarmupPoolTypeDemotesARestrictedOrganization(t *testing.T) {
	org := uuid.New()
	account := &models.Email{ID: uuid.New(), OrganizationID: &org, Status: "active", WarmupPoolType: "premium"}

	for _, tc := range []struct {
		name  string
		risk  *poolTypeRiskRepo
		wants string
	}{
		{"restricted", &poolTypeRiskRepo{states: map[uuid.UUID]models.OrgRiskState{org: models.OrgRiskRestricted}}, "free"},
		{"suspended", &poolTypeRiskRepo{states: map[uuid.UUID]models.OrgRiskState{org: models.OrgRiskSuspended}}, "free"},
		{"trusted", &poolTypeRiskRepo{states: map[uuid.UUID]models.OrgRiskState{org: models.OrgRiskTrusted}}, "premium"},
		{"unknown org", &poolTypeRiskRepo{states: map[uuid.UUID]models.OrgRiskState{}}, "premium"},
		{"lookup failure fails open", &poolTypeRiskRepo{err: errors.New("connection reset by peer")}, "premium"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc := &emailService{orgRiskRepo: tc.risk}
			if got := svc.resolveWarmupPoolType(context.Background(), account); got != tc.wants {
				t.Fatalf("resolved %q, want %q", got, tc.wants)
			}
		})
	}
}

// Without the risk repository wired (jobs, tests) the stored tier stands.
func TestResolveWarmupPoolTypeWithoutRiskUsesTheStoredTier(t *testing.T) {
	org := uuid.New()
	svc := &emailService{}
	account := &models.Email{ID: uuid.New(), OrganizationID: &org, Status: "active", WarmupPoolType: "premium"}

	if got := svc.resolveWarmupPoolType(context.Background(), account); got != "premium" {
		t.Fatalf("resolved %q, want premium", got)
	}
}
