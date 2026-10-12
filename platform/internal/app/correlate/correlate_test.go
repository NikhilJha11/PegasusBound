package correlate

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/pegasusbound/pegasusbound/internal/app/orgrisk"
	"github.com/pegasusbound/pegasusbound/internal/models"
	"github.com/pegasusbound/pegasusbound/internal/repository"
)

// stubRiskRepo is the risk table in memory, so the sweep runs against the real
// fusion rules rather than a fake that agrees with the test.
type stubRiskRepo struct {
	rows map[uuid.UUID]*models.OrgRisk
}

func newStubRiskRepo() *stubRiskRepo {
	return &stubRiskRepo{rows: map[uuid.UUID]*models.OrgRisk{}}
}

func (s *stubRiskRepo) row(orgID uuid.UUID) *models.OrgRisk {
	if r, ok := s.rows[orgID]; ok {
		return r
	}
	r := &models.OrgRisk{OrganizationID: orgID, State: models.OrgRiskTrusted, Signals: map[string]any{}}
	s.rows[orgID] = r
	return r
}

func (s *stubRiskRepo) GetOrgRisk(_ context.Context, orgID uuid.UUID) (*models.OrgRisk, error) {
	copied := *s.row(orgID)
	return &copied, nil
}

func (s *stubRiskRepo) GetOrgRiskStates(_ context.Context, ids []uuid.UUID) (map[uuid.UUID]models.OrgRiskState, error) {
	out := map[uuid.UUID]models.OrgRiskState{}
	for _, id := range ids {
		if r, ok := s.rows[id]; ok {
			out[id] = r.State
		}
	}
	return out, nil
}

func (s *stubRiskRepo) UpdateOrgRiskSignals(_ context.Context, orgID uuid.UUID,
	derive repository.OrgRiskDerive) (*models.OrgRisk, error) {
	return s.write(orgID, derive), nil
}

// write models the stored row: the derived score always lands, but the band
// only does when no operator pin outranks it.
func (s *stubRiskRepo) write(orgID uuid.UUID, derive repository.OrgRiskDerive) *models.OrgRisk {
	row := s.row(orgID)
	signals, state, score, reason := derive(row.Signals)
	row.Signals, row.Score, row.Reason = signals, score, reason
	if row.Override != nil {
		row.State = row.Override.State
	} else {
		row.State = state
	}
	copied := *row
	return &copied
}

func (s *stubRiskRepo) ClearOrgRiskOverride(_ context.Context, orgID uuid.UUID,
	derive repository.OrgRiskDerive) (*models.OrgRisk, error) {
	s.row(orgID).Override = nil
	return s.write(orgID, derive), nil
}

func (s *stubRiskRepo) SetOrgRiskOverride(_ context.Context, orgID uuid.UUID,
	state models.OrgRiskState, reason string, by uuid.UUID) (*models.OrgRisk, error) {
	row := s.row(orgID)
	actor := by
	row.State, row.Reason = state, reason
	row.Override = &models.OrgRiskOverride{State: state, Reason: reason, By: &actor}
	copied := *row
	return &copied, nil
}

func (s *stubRiskRepo) OrgsWithExpiringSignals(context.Context) ([]uuid.UUID, error) {
	var out []uuid.UUID
	for id, row := range s.rows {
		for _, raw := range row.Signals {
			if entry, ok := raw.(map[string]any); ok {
				if _, dated := entry["expires_at"]; dated {
					out = append(out, id)
					break
				}
			}
		}
	}
	return out, nil
}

func (s *stubRiskRepo) OrgsWithSignal(_ context.Context, key string) ([]uuid.UUID, error) {
	var out []uuid.UUID
	for id, row := range s.rows {
		if _, ok := row.Signals[key]; ok {
			out = append(out, id)
		}
	}
	return out, nil
}

type stubCorrelation struct {
	ip       []repository.Cluster
	identity []repository.Cluster
	bursts   []repository.Cluster
}

func (s *stubCorrelation) ClustersBySignupIP(context.Context, int, time.Time) ([]repository.Cluster, error) {
	return s.ip, nil
}
func (s *stubCorrelation) ClustersBySignupIdentity(context.Context, int, time.Time) ([]repository.Cluster, error) {
	return s.identity, nil
}
func (s *stubCorrelation) OrgsConnectingMailboxesFast(context.Context, int, time.Duration) ([]repository.Cluster, error) {
	return s.bursts, nil
}

type stubConduct struct {
	rows []repository.OrgConduct
	err  error
}

func (s *stubConduct) OrgRecipientOutcomes(context.Context, int, time.Duration) ([]repository.OrgConduct, error) {
	return s.rows, s.err
}

func weightOf(t *testing.T, row *models.OrgRisk, key string) (int, orgrisk.SignalClass) {
	t.Helper()
	entry, ok := row.Signals[key].(map[string]any)
	if !ok {
		t.Fatalf("signal %q was not recorded (have %v)", key, row.Signals)
	}
	weight, _ := entry["weight"].(int)
	class, _ := entry["class"].(string)
	return weight, orgrisk.SignalClass(class)
}

// Issue #245: an agency's three client workspaces, opened from one office by
// one operator, with the mailboxes connected the same afternoon. The sweep
// still files everything it sees, and the workspace still ends at watch.
func TestSweepFilesAgencyShapeWithoutRestricting(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	repo := newStubRiskRepo()
	svc := NewService(&stubCorrelation{
		ip:       []repository.Cluster{{Key: "203.0.113.7", OrganizationIDs: []uuid.UUID{a, b, c}}},
		identity: []repository.Cluster{{Key: "ops@agency.com", OrganizationIDs: []uuid.UUID{a, b, c}}},
		bursts:   []repository.Cluster{{Key: a.String(), OrganizationIDs: []uuid.UUID{a}}},
	}, nil, orgrisk.NewService(repo))

	svc.Run(context.Background())

	row, _ := repo.GetOrgRisk(context.Background(), a)
	for key, want := range map[string]int{
		"cluster_signup_ip":       weightSharedIP,
		"cluster_signup_identity": weightSharedIdentity,
		"mailbox_burst":           weightMailboxBurst,
	} {
		got, class := weightOf(t, row, key)
		if got != want {
			t.Errorf("%s weight = %d, want %d", key, got, want)
		}
		if class != orgrisk.ClassCircumstantial {
			t.Errorf("%s class = %q, want circumstantial", key, class)
		}
	}
	if row.State != models.OrgRiskWatch {
		t.Errorf("state = %q, want watch: none of this is conduct", row.State)
	}
	if row.Score != orgrisk.CircumstantialCap {
		t.Errorf("score = %d, want %d", row.Score, orgrisk.CircumstantialCap)
	}

	// The workspace with no burst carries only the two cluster findings, which
	// are one family and therefore one weight.
	other, _ := repo.GetOrgRisk(context.Background(), b)
	if other.Score != weightSharedIdentity {
		t.Errorf("score = %d, want the family counted once (%d)", other.Score, weightSharedIdentity)
	}
	if other.State != models.OrgRiskWatch {
		t.Errorf("state = %q, want watch", other.State)
	}
}

// A cluster that ages out has to give the weight back, or a score can only ever
// climb.
func TestSweepRetractsFindingsThatNoLongerHold(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	repo := newStubRiskRepo()
	corr := &stubCorrelation{
		identity: []repository.Cluster{{Key: "ops@agency.com", OrganizationIDs: []uuid.UUID{a, b, c}}},
	}
	svc := NewService(corr, nil, orgrisk.NewService(repo))

	svc.Run(context.Background())
	if row, _ := repo.GetOrgRisk(context.Background(), a); row.State != models.OrgRiskWatch {
		t.Fatalf("state = %q, want the finding recorded first", row.State)
	}

	corr.identity = nil
	svc.Run(context.Background())

	row, _ := repo.GetOrgRisk(context.Background(), a)
	if _, still := row.Signals["cluster_signup_identity"]; still {
		t.Error("the finding survived a sweep that no longer matched it")
	}
	if row.State != models.OrgRiskTrusted || row.Score != 0 {
		t.Errorf("state = %q/%d, want trusted/0", row.State, row.Score)
	}
}

// Recipient outcomes are the evidence a band may act on, so the bands
// themselves are worth pinning to the numbers providers publish.
func TestHarmFindingsBands(t *testing.T) {
	org := uuid.New()
	for _, tt := range []struct {
		name       string
		row        repository.OrgConduct
		wantWeight int
		wantDetail string
	}{
		{"under the sample floor", repository.OrgConduct{OrganizationID: org, Sent: 99, Complained: 10}, 0, ""},
		{"clean", repository.OrgConduct{OrganizationID: org, Sent: 1000, Bounced: 20, Complained: 0}, 0, ""},
		{"complaints in the warning band", repository.OrgConduct{OrganizationID: org, Sent: 1000, Complained: 1}, weightHarmWarning,
			"recipients reported 0.10% of the last 1000 sends as spam"},
		{"complaints past the band providers act on", repository.OrgConduct{OrganizationID: org, Sent: 1000, Complained: 3}, weightHarmCritical,
			"recipients reported 0.30% of the last 1000 sends as spam"},
		{"bounces in the warning band", repository.OrgConduct{OrganizationID: org, Sent: 1000, Bounced: 50}, weightHarmWarning,
			"5.0% of the last 1000 sends bounced"},
		{"bounces past the band providers act on", repository.OrgConduct{OrganizationID: org, Sent: 1000, Bounced: 100}, weightHarmCritical,
			"10.0% of the last 1000 sends bounced"},
		{"both, at the heavier band", repository.OrgConduct{OrganizationID: org, Sent: 1000, Bounced: 100, Complained: 1}, weightHarmCritical,
			"recipients reported 0.10% of the last 1000 sends as spam; 10.0% of the last 1000 sends bounced"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := harmFindings([]repository.OrgConduct{tt.row})
			if tt.wantWeight == 0 {
				if len(got) != 0 {
					t.Fatalf("got %v, want no finding", got)
				}
				return
			}
			f, ok := got[org]
			if !ok {
				t.Fatalf("no finding recorded for %v", tt.row)
			}
			if f.weight != tt.wantWeight {
				t.Errorf("weight = %d, want %d", f.weight, tt.wantWeight)
			}
			if f.detail != tt.wantDetail {
				t.Errorf("detail = %q, want %q", f.detail, tt.wantDetail)
			}
		})
	}
}

// Conduct decides the band. An organization whose recipients are reporting it
// is restricted whether or not it shares anything with anyone.
func TestSweepRestrictsOnRecipientHarm(t *testing.T) {
	org := uuid.New()
	repo := newStubRiskRepo()
	conduct := &stubConduct{rows: []repository.OrgConduct{
		{OrganizationID: org, Sent: 900, Complained: 4},
	}}
	svc := NewService(&stubCorrelation{}, conduct, orgrisk.NewService(repo))

	svc.Run(context.Background())

	row, _ := repo.GetOrgRisk(context.Background(), org)
	weight, class := weightOf(t, row, "recipient_harm")
	if weight != weightHarmCritical || class != orgrisk.ClassSubstantive {
		t.Errorf("recipient_harm = %d/%q, want %d/substantive", weight, class, weightHarmCritical)
	}
	if row.State != models.OrgRiskRestricted {
		t.Errorf("state = %q, want restricted", row.State)
	}

	// It has to come back off when the rates recover.
	conduct.rows = []repository.OrgConduct{{OrganizationID: org, Sent: 900, Complained: 0}}
	svc.Run(context.Background())
	row, _ = repo.GetOrgRisk(context.Background(), org)
	if _, still := row.Signals["recipient_harm"]; still {
		t.Error("the finding survived rates that no longer breach a band")
	}
	if row.State != models.OrgRiskTrusted {
		t.Errorf("state = %q, want trusted", row.State)
	}
}

// A pass that could not run must leave its findings alone. Retracting on a
// failed query would quietly release every organization it had flagged.
func TestSweepKeepsHarmWhenThePassCannotRun(t *testing.T) {
	org := uuid.New()
	repo := newStubRiskRepo()
	conduct := &stubConduct{rows: []repository.OrgConduct{{OrganizationID: org, Sent: 900, Complained: 4}}}
	risk := orgrisk.NewService(repo)
	svc := NewService(&stubCorrelation{}, conduct, risk)
	svc.Run(context.Background())

	conduct.rows, conduct.err = nil, errors.New("query failed")
	svc.Run(context.Background())
	if row, _ := repo.GetOrgRisk(context.Background(), org); row.State != models.OrgRiskRestricted {
		t.Errorf("state = %q, want the finding to survive a failed pass", row.State)
	}

	// Same for a deployment with no conduct repository wired at all.
	NewService(&stubCorrelation{}, nil, risk).Run(context.Background())
	if row, _ := repo.GetOrgRisk(context.Background(), org); row.State != models.OrgRiskRestricted {
		t.Errorf("state = %q, want the finding untouched when the pass is absent", row.State)
	}
}
