package repository

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/pegasusbound/pegasusbound/internal/models"
)

// Issue #141: the fused org posture. These prove the parts that only the
// database can decide: the concurrent-safe read/derive/write, and that an
// operator's decision is not undone by a detector clearing.
//
// Issue #241: and that the decision can be lifted again. A suspension used to
// be pinned by the UPDATE itself, so nothing in the product could reach a
// workspace once it got there.
//
//	PEGASUSBOUND_TEST_DB=postgres://pegasusbound:pegasusbound@localhost:15432/pegasusbound_dev?sslmode=disable \
//	  go test ./internal/repository/ -run LiveOrgRisk -v

func newRiskOrg(t *testing.T) (OrgRiskRepository, uuid.UUID, uuid.UUID) {
	t.Helper()
	handle, pool := liveContactDB(t)
	ctx := context.Background()
	user, org := uuid.New(), uuid.New()

	if _, err := pool.Exec(ctx, `INSERT INTO users (id, email, first_name, last_name) VALUES ($1, $2, 'Risk', 'Test')`,
		user, "risk-"+user.String()[:8]+"@test.local"); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO organizations (id, name, slug, owner_user_id) VALUES ($1, 'Risk Test', $2, $3)`,
		org, "risk-"+org.String()[:8], user); err != nil {
		t.Fatalf("insert org: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		if _, err := pool.Exec(c, `DELETE FROM organizations WHERE id = $1`, org); err != nil {
			t.Errorf("cleanup org: %v", err)
		}
		if _, err := pool.Exec(c, `DELETE FROM users WHERE id = $1`, user); err != nil {
			t.Errorf("cleanup user: %v", err)
		}
	})
	return NewOrgRiskRepository(handle), org, user
}

func TestLiveOrgRiskDefaultsToTrusted(t *testing.T) {
	repo, org, _ := newRiskOrg(t)
	risk, err := repo.GetOrgRisk(context.Background(), org)
	if err != nil {
		t.Fatalf("GetOrgRisk: %v", err)
	}
	if risk.State != models.OrgRiskTrusted || risk.Score != 0 {
		t.Errorf("a new workspace reads %q/%d, want trusted/0", risk.State, risk.Score)
	}
	if risk.Restricted() {
		t.Error("a new workspace must not be restricted")
	}
}

func TestLiveOrgRiskDerivesBandFromSignals(t *testing.T) {
	repo, org, _ := newRiskOrg(t)
	ctx := context.Background()

	set := func(key string, weight int) *models.OrgRisk {
		t.Helper()
		risk, err := repo.UpdateOrgRiskSignals(ctx, org,
			func(signals map[string]any) (map[string]any, models.OrgRiskState, int, string) { //nolint:dupl
				signals[key] = map[string]any{"weight": weight, "detail": key}
				score := 0
				for _, raw := range signals {
					if m, ok := raw.(map[string]any); ok {
						if w, ok := m["weight"].(float64); ok {
							score += int(w)
						} else if w, ok := m["weight"].(int); ok {
							score += w
						}
					}
				}
				state := models.OrgRiskTrusted
				switch {
				case score >= 85:
					state = models.OrgRiskSuspended
				case score >= 50:
					state = models.OrgRiskRestricted
				case score >= 25:
					state = models.OrgRiskWatch
				}
				return signals, state, score, key
			})
		if err != nil {
			t.Fatalf("UpdateOrgRiskSignals: %v", err)
		}
		return risk
	}

	if risk := set("first", 30); risk.State != models.OrgRiskWatch {
		t.Errorf("30 points reads %q, want watch", risk.State)
	}
	// The point of fusing: a second tolerable signal crosses a band neither
	// would reach alone.
	risk := set("second", 30)
	if risk.State != models.OrgRiskRestricted || risk.Score != 60 {
		t.Errorf("two signals read %q/%d, want restricted/60", risk.State, risk.Score)
	}
	if !risk.Restricted() {
		t.Error("a restricted workspace must report as restricted")
	}
	if len(risk.Signals) != 2 {
		t.Errorf("evidence has %d entries, want both signals kept for review", len(risk.Signals))
	}
}

// An operator's decision outranks the score. A detector clearing must not
// quietly release a workspace a human suspended.
func TestLiveOrgRiskOverrideSurvivesSignalsClearing(t *testing.T) {
	repo, org, actor := newRiskOrg(t)
	ctx := context.Background()

	if _, err := repo.SetOrgRiskOverride(ctx, org, models.OrgRiskSuspended, "manual review", actor); err != nil {
		t.Fatalf("SetOrgRiskOverride: %v", err)
	}

	risk, err := repo.UpdateOrgRiskSignals(ctx, org, clearedDerive)
	if err != nil {
		t.Fatalf("UpdateOrgRiskSignals: %v", err)
	}
	if risk.State != models.OrgRiskSuspended {
		t.Errorf("state = %q, want the operator's suspension to hold", risk.State)
	}
	if risk.Score != 0 {
		t.Errorf("score = %d, want the derived 0; only the band is pinned", risk.Score)
	}
	if risk.Reason != "manual review" {
		t.Errorf("reason = %q, want the operator's reason while pinned", risk.Reason)
	}
	if risk.Override == nil || risk.Override.State != models.OrgRiskSuspended {
		t.Fatalf("override = %+v, want the pin recorded", risk.Override)
	}
	if risk.Override.By == nil || *risk.Override.By != actor {
		t.Errorf("override.By = %v, want the operator who set it", risk.Override.By)
	}
	if risk.Override.At == nil {
		t.Error("override.At is nil, want when it was set")
	}
}

// Issue #241: the way back out. Clearing the pin re-derives from the evidence
// in the same transaction, so the row is never pinned to nothing.
func TestLiveOrgRiskOverrideCanBeLifted(t *testing.T) {
	repo, org, actor := newRiskOrg(t)
	ctx := context.Background()

	if _, err := repo.SetOrgRiskOverride(ctx, org, models.OrgRiskSuspended, "manual review", actor); err != nil {
		t.Fatalf("SetOrgRiskOverride: %v", err)
	}

	risk, err := repo.ClearOrgRiskOverride(ctx, org, clearedDerive)
	if err != nil {
		t.Fatalf("ClearOrgRiskOverride: %v", err)
	}
	if risk.Override != nil {
		t.Errorf("override = %+v, want it gone", risk.Override)
	}
	if risk.State != models.OrgRiskTrusted || risk.Score != 0 {
		t.Errorf("state/score = %q/%d, want the evidence to decide again: trusted/0",
			risk.State, risk.Score)
	}
	// And it stays gone: the next detector write is no longer outranked.
	risk, err = repo.UpdateOrgRiskSignals(ctx, org,
		func(map[string]any) (map[string]any, models.OrgRiskState, int, string) {
			return map[string]any{"x": map[string]any{"weight": 30, "detail": "x"}},
				models.OrgRiskWatch, 30, "x"
		})
	if err != nil {
		t.Fatalf("UpdateOrgRiskSignals: %v", err)
	}
	if risk.State != models.OrgRiskWatch {
		t.Errorf("state = %q, want the detectors back in charge", risk.State)
	}
}

// An operator lifting a suspension has to survive the detector that put the
// workspace there, or the release lasts until the next sweep.
func TestLiveOrgRiskOverrideHoldsAgainstStandingEvidence(t *testing.T) {
	repo, org, actor := newRiskOrg(t)
	ctx := context.Background()

	suspend := func(map[string]any) (map[string]any, models.OrgRiskState, int, string) {
		return map[string]any{"heavy": map[string]any{"weight": 90, "detail": "confirmed abuse"}},
			models.OrgRiskSuspended, 90, "confirmed abuse"
	}
	if _, err := repo.UpdateOrgRiskSignals(ctx, org, suspend); err != nil {
		t.Fatalf("UpdateOrgRiskSignals: %v", err)
	}
	if _, err := repo.SetOrgRiskOverride(ctx, org, models.OrgRiskTrusted, "reviewed, legitimate", actor); err != nil {
		t.Fatalf("SetOrgRiskOverride: %v", err)
	}

	risk, err := repo.UpdateOrgRiskSignals(ctx, org, suspend)
	if err != nil {
		t.Fatalf("UpdateOrgRiskSignals: %v", err)
	}
	if risk.State != models.OrgRiskTrusted {
		t.Errorf("state = %q, want the pin to survive the detector re-recording", risk.State)
	}
	if risk.Score != 90 {
		t.Errorf("score = %d, want the evidence still scored under the pin", risk.Score)
	}
}

// Only organizations holding dated evidence are swept, so the expiry pass
// does not re-derive every workspace on the instance.
func TestLiveOrgRiskListsOrgsWithExpiringSignals(t *testing.T) {
	repo, org, _ := newRiskOrg(t)
	ctx := context.Background()

	if _, err := repo.UpdateOrgRiskSignals(ctx, org,
		func(map[string]any) (map[string]any, models.OrgRiskState, int, string) {
			return map[string]any{"undated": map[string]any{"weight": 10, "detail": "no expiry"}},
				models.OrgRiskTrusted, 10, "no expiry"
		}); err != nil {
		t.Fatalf("UpdateOrgRiskSignals: %v", err)
	}
	ids, err := repo.OrgsWithExpiringSignals(ctx)
	if err != nil {
		t.Fatalf("OrgsWithExpiringSignals: %v", err)
	}
	if containsOrg(ids, org) {
		t.Error("a workspace whose evidence carries no expiry must not be swept")
	}

	if _, err := repo.UpdateOrgRiskSignals(ctx, org,
		func(signals map[string]any) (map[string]any, models.OrgRiskState, int, string) {
			signals["dated"] = map[string]any{"weight": 10, "detail": "ages out", "expires_at": "2020-01-01T00:00:00Z"}
			return signals, models.OrgRiskTrusted, 20, "ages out"
		}); err != nil {
		t.Fatalf("UpdateOrgRiskSignals: %v", err)
	}
	ids, err = repo.OrgsWithExpiringSignals(ctx)
	if err != nil {
		t.Fatalf("OrgsWithExpiringSignals: %v", err)
	}
	if !containsOrg(ids, org) {
		t.Error("a workspace holding dated evidence was not offered to the sweep")
	}
}

// clearedDerive is the state after every detector has retracted.
func clearedDerive(map[string]any) (map[string]any, models.OrgRiskState, int, string) {
	return map[string]any{}, models.OrgRiskTrusted, 0, ""
}

func containsOrg(ids []uuid.UUID, want uuid.UUID) bool {
	for _, id := range ids {
		if id == want {
			return true
		}
	}
	return false
}

func TestLiveOrgRiskStatesBatch(t *testing.T) {
	repo, org, _ := newRiskOrg(t)
	ctx := context.Background()
	// uuid.Nil is the no-operator pin: the column is nullable on purpose.
	if _, err := repo.SetOrgRiskOverride(ctx, org, models.OrgRiskRestricted, "test", uuid.Nil); err != nil {
		t.Fatalf("SetOrgRiskOverride: %v", err)
	}

	states, err := repo.GetOrgRiskStates(ctx, []uuid.UUID{org, uuid.New()})
	if err != nil {
		t.Fatalf("GetOrgRiskStates: %v", err)
	}
	if states[org] != models.OrgRiskRestricted {
		t.Errorf("state = %q, want restricted", states[org])
	}
	// An unknown organization must read as the zero value, which the callers
	// treat as unrestricted rather than as an error.
	if len(states) != 1 {
		t.Errorf("got %d states, want only the real organization", len(states))
	}
	if states[org].CapMultiplier() != 0.25 {
		t.Errorf("restricted cap multiplier = %v, want 0.25", states[org].CapMultiplier())
	}
}

// An operator working from a stale id must be told the organization is gone,
// not handed an internal error. Every write path answers the same way.
func TestLiveOrgRiskUnknownOrganizationIsNotAnError(t *testing.T) {
	repo, _, _ := newRiskOrg(t)
	ctx := context.Background()
	gone := uuid.New()

	risk, err := repo.GetOrgRisk(ctx, gone)
	if err != nil || risk != nil {
		t.Errorf("GetOrgRisk = %v, %v; want nil, nil", risk, err)
	}
	risk, err = repo.SetOrgRiskOverride(ctx, gone, models.OrgRiskSuspended, "x", uuid.Nil)
	if err != nil || risk != nil {
		t.Errorf("SetOrgRiskOverride = %v, %v; want nil, nil", risk, err)
	}
	risk, err = repo.UpdateOrgRiskSignals(ctx, gone, clearedDerive)
	if err != nil || risk != nil {
		t.Errorf("UpdateOrgRiskSignals = %v, %v; want nil, nil", risk, err)
	}
	risk, err = repo.ClearOrgRiskOverride(ctx, gone, clearedDerive)
	if err != nil || risk != nil {
		t.Errorf("ClearOrgRiskOverride = %v, %v; want nil, nil", risk, err)
	}
}
