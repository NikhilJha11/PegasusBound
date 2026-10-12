package tasks

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/pegasusbound/pegasusbound/internal/app/feature"
	warmupapp "github.com/pegasusbound/pegasusbound/internal/app/warmup"
	"github.com/pegasusbound/pegasusbound/internal/errx"
	"github.com/pegasusbound/pegasusbound/internal/models"
	"github.com/pegasusbound/pegasusbound/internal/repository"
)

// Stubs embed their interface, so any call this pass is not supposed to make
// panics instead of quietly passing.

type poolReconcileWarmupRepo struct {
	repository.WarmupRepository
	participants []uuid.UUID
	listErr      error
}

func (r *poolReconcileWarmupRepo) GetAllParticipantAccountIDs(_ context.Context) ([]uuid.UUID, error) {
	return r.participants, r.listErr
}

type poolReconcileEmailRepo struct {
	repository.EmailRepository
	accounts map[uuid.UUID]*models.Email
}

func (r *poolReconcileEmailRepo) GetByID(_ context.Context, id uuid.UUID) (*models.Email, *errx.Error) {
	return r.accounts[id], nil
}

type poolReconcileGate struct {
	feature.FeatureGateService
	entitled map[uuid.UUID]bool
	fail     bool
	calls    int
}

func (g *poolReconcileGate) CanUseWarmup(_ context.Context, orgID uuid.UUID) (bool, *errx.Error) {
	g.calls++
	if g.fail {
		return false, errx.InternalError()
	}
	return g.entitled[orgID], nil
}

type poolReconcileWarmup struct {
	warmupapp.Service
	moved   map[uuid.UUID]string
	removed map[uuid.UUID]bool
	// inPool is where each mailbox currently sits, so MovePoolMembership can
	// report honestly whether it had anything to move.
	inPool map[uuid.UUID]string
}

func (w *poolReconcileWarmup) MovePoolMembership(_ context.Context, accountID uuid.UUID, poolType string) (bool, *errx.Error) {
	if w.inPool[accountID] == poolType {
		return false, nil
	}
	w.inPool[accountID] = poolType
	w.moved[accountID] = poolType
	return true, nil
}

func (w *poolReconcileWarmup) RemoveFromAllPools(_ context.Context, accountID uuid.UUID) *errx.Error {
	w.removed[accountID] = true
	delete(w.inPool, accountID)
	return nil
}

type poolReconcileFixture struct {
	svc     *tasksService
	gate    *poolReconcileGate
	warmup  *poolReconcileWarmup
	emails  *poolReconcileEmailRepo
	orgPaid uuid.UUID
	orgFree uuid.UUID
}

func newPoolReconcileFixture() *poolReconcileFixture {
	f := &poolReconcileFixture{
		orgPaid: uuid.New(),
		orgFree: uuid.New(),
	}
	f.gate = &poolReconcileGate{entitled: map[uuid.UUID]bool{}}
	f.warmup = &poolReconcileWarmup{
		moved:   map[uuid.UUID]string{},
		removed: map[uuid.UUID]bool{},
		inPool:  map[uuid.UUID]string{},
	}
	f.emails = &poolReconcileEmailRepo{accounts: map[uuid.UUID]*models.Email{}}
	f.gate.entitled[f.orgPaid] = true
	f.gate.entitled[f.orgFree] = false
	return f
}

// mailbox registers an account and the pool its participant row is currently in.
func (f *poolReconcileFixture) mailbox(orgID uuid.UUID, poolType, sittingIn string) uuid.UUID {
	id := uuid.New()
	org := orgID
	f.emails.accounts[id] = &models.Email{
		ID:             id,
		OrganizationID: &org,
		Status:         "active",
		WarmupPoolType: poolType,
	}
	f.warmup.inPool[id] = sittingIn
	return id
}

func (f *poolReconcileFixture) run(t *testing.T) (int, int) {
	t.Helper()
	participants := make([]uuid.UUID, 0, len(f.warmup.inPool))
	for id := range f.warmup.inPool {
		participants = append(participants, id)
	}
	f.svc = &tasksService{
		warmupRepo:   &poolReconcileWarmupRepo{participants: participants},
		emailRepo:    f.emails,
		featureGate:  f.gate,
		warmupHealth: f.warmup,
	}
	moved, removed, err := f.svc.ReconcileWarmupPoolMembership(context.Background())
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	return moved, removed
}

// The headline defect: a downgraded mailbox keeps its premium row, so paying
// customers go on being handed a mailbox with no paid entitlement as a warmup
// partner. Nothing revisits it, because a mailbox that stopped warming is not a
// schedule candidate.
func TestPoolReconcileEvictsAMailboxThatLostItsEntitlement(t *testing.T) {
	f := newPoolReconcileFixture()
	downgraded := f.mailbox(f.orgFree, "free", "premium")

	_, removed := f.run(t)

	if removed != 1 {
		t.Fatalf("removed %d mailboxes, want 1", removed)
	}
	if !f.warmup.removed[downgraded] {
		t.Fatal("the downgraded mailbox is still in a warmup pool")
	}
	if _, still := f.warmup.inPool[downgraded]; still {
		t.Fatal("membership survived the eviction")
	}
}

// An entitled mailbox whose tier moved is corrected rather than evicted.
func TestPoolReconcileMovesAnEntitledMailboxToItsOwnPool(t *testing.T) {
	f := newPoolReconcileFixture()
	upgraded := f.mailbox(f.orgPaid, "premium", "free")

	moved, removed := f.run(t)

	if moved != 1 || removed != 0 {
		t.Fatalf("moved %d removed %d, want 1 and 0", moved, removed)
	}
	if f.warmup.moved[upgraded] != "premium" {
		t.Fatalf("moved to %q, want premium", f.warmup.moved[upgraded])
	}
}

// Steady state costs nothing: a mailbox already in the right pool is left alone.
func TestPoolReconcileLeavesASettledMailboxAlone(t *testing.T) {
	f := newPoolReconcileFixture()
	f.mailbox(f.orgPaid, "premium", "premium")

	moved, removed := f.run(t)

	if moved != 0 || removed != 0 {
		t.Fatalf("moved %d removed %d, want 0 and 0", moved, removed)
	}
}

// An unreadable subscription is not evidence that a mailbox lost warmup. If a
// blip could evict, one bad minute would empty the pool.
func TestPoolReconcileLeavesMembershipAloneWhenEntitlementCannotBeRead(t *testing.T) {
	f := newPoolReconcileFixture()
	mailbox := f.mailbox(f.orgPaid, "premium", "free")
	f.gate.fail = true

	moved, removed := f.run(t)

	if moved != 0 || removed != 0 {
		t.Fatalf("moved %d removed %d, want the mailbox untouched", moved, removed)
	}
	if f.warmup.removed[mailbox] {
		t.Fatal("evicted a mailbox on an entitlement lookup failure")
	}
}

// A participant row whose mailbox is gone, suspended, or has no workspace has
// nothing left to check an entitlement against, so it leaves the shared pool.
func TestPoolReconcileEvictsMailboxesItCannotVouchFor(t *testing.T) {
	for _, c := range []struct {
		name    string
		account func(id uuid.UUID) *models.Email
	}{
		{"deleted", func(uuid.UUID) *models.Email { return nil }},
		{"inactive", func(id uuid.UUID) *models.Email {
			org := uuid.New()
			return &models.Email{ID: id, OrganizationID: &org, Status: "inactive", WarmupPoolType: "premium"}
		}},
		{"no workspace", func(id uuid.UUID) *models.Email {
			return &models.Email{ID: id, Status: "active", WarmupPoolType: "premium"}
		}},
	} {
		t.Run(c.name, func(t *testing.T) {
			f := newPoolReconcileFixture()
			id := f.mailbox(f.orgPaid, "premium", "premium")
			f.emails.accounts[id] = c.account(id)

			_, removed := f.run(t)

			if removed != 1 || !f.warmup.removed[id] {
				t.Fatalf("removed %d, want the mailbox out of the pool", removed)
			}
		})
	}
}

// One subscription lookup per workspace, not per mailbox.
func TestPoolReconcileAsksAboutEachOrganizationOnce(t *testing.T) {
	f := newPoolReconcileFixture()
	for i := 0; i < 5; i++ {
		f.mailbox(f.orgPaid, "premium", "premium")
	}

	f.run(t)

	if f.gate.calls != 1 {
		t.Fatalf("asked about the same organization %d times, want 1", f.gate.calls)
	}
}

// A listing failure is reported, not swallowed into a silent no-op pass.
func TestPoolReconcileReportsAListingFailure(t *testing.T) {
	svc := &tasksService{
		warmupRepo:   &poolReconcileWarmupRepo{listErr: errors.New("connection reset by peer")},
		emailRepo:    &poolReconcileEmailRepo{},
		warmupHealth: &poolReconcileWarmup{},
	}

	if _, _, err := svc.ReconcileWarmupPoolMembership(context.Background()); err == nil {
		t.Fatal("expected the listing failure to surface")
	}
}
