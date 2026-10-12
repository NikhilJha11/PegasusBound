package repository

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Issue #245: the pass that reads what an organization's mail did to the people
// who received it. Only the database can prove the window, the sample floor and
// the attribution.
//
//	PEGASUSBOUND_TEST_DB=postgres://pegasusbound:pegasusbound@localhost:15432/pegasusbound_dev?sslmode=disable \
//	  go test ./internal/repository/ -run LiveOrgConduct -v

// conductFixture is one organization with a campaign whose progress rows the
// test stamps as sent, bounced or complained.
type conductFixture struct {
	org      uuid.UUID
	user     uuid.UUID
	campaign uuid.UUID
	sequence uuid.UUID
	pool     *pgxpool.Pool
}

func newConductFixture(t *testing.T) *conductFixture {
	t.Helper()
	_, pool := liveContactDB(t)
	ctx := context.Background()
	f := &conductFixture{
		org: uuid.New(), user: uuid.New(), campaign: uuid.New(), sequence: uuid.New(), pool: pool,
	}

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("fixture: %v", err)
		}
	}
	exec(`INSERT INTO users (id, first_name, last_name, email, password_hash)
	      VALUES ($1, 'Conduct', 'Live', $2, 'x')`, f.user, "i245-"+f.user.String()[:8]+"@test.local")
	exec(`INSERT INTO organizations (id, name, slug, owner_user_id)
	      VALUES ($1, 'Issue 245', $2, $3)`, f.org, "i245-"+f.org.String()[:8], f.user)
	exec(`INSERT INTO campaigns (id, user_id, organization_id, name, description, days, updated_at, created_at)
	      VALUES ($1, $2, $3, 'Conduct', '', 62, NOW(), NOW())`, f.campaign, f.user, f.org)
	exec(`INSERT INTO sequences (id, campaign_id, organization_id, name, subject, body_plain, body_html)
	      VALUES ($1, $2, $3, 'Step one', 'Hi', 'Hi', '')`, f.sequence, f.campaign, f.org)

	t.Cleanup(func() {
		c := context.Background()
		for _, sql := range []string{
			`DELETE FROM campaign_contact_progress WHERE campaign_id = $1`,
		} {
			if _, err := pool.Exec(c, sql, f.campaign); err != nil {
				t.Errorf("cleanup: %v", err)
			}
		}
		for _, sql := range []string{
			`DELETE FROM contacts WHERE organization_id = $1`,
			`DELETE FROM sequences WHERE organization_id = $1`,
			`DELETE FROM campaigns WHERE organization_id = $1`,
			`DELETE FROM organizations WHERE id = $1`,
		} {
			if _, err := pool.Exec(c, sql, f.org); err != nil {
				t.Errorf("cleanup: %v", err)
			}
		}
		if _, err := pool.Exec(c, `DELETE FROM users WHERE id = $1`, f.user); err != nil {
			t.Errorf("cleanup user: %v", err)
		}
	})
	return f
}

// send writes n progress rows sent `age` ago, the first `bounced` of them
// bounced and the first `complained` of them complained about.
func (f *conductFixture) send(t *testing.T, n, bounced, complained int, age time.Duration) {
	t.Helper()
	ctx := context.Background()
	for i := 0; i < n; i++ {
		contact := uuid.New()
		if _, err := f.pool.Exec(ctx,
			`INSERT INTO contacts (id, user_id, organization_id, email, first_name, last_name, company, phone, custom_fields, updated_at, created_at)
			 VALUES ($1, $2, $3, $4, 'C', 'D', '', '', '{}'::jsonb, NOW(), NOW())`,
			contact, f.user, f.org, "i245-"+contact.String()[:12]+"@test.local"); err != nil {
			t.Fatalf("contact: %v", err)
		}
		if _, err := f.pool.Exec(ctx,
			`INSERT INTO campaign_contact_progress (campaign_id, contact_id, sequence_id, sent_at, bounced_at, complained_at)
			 VALUES ($1, $2, $3, NOW() - $4::interval,
			         CASE WHEN $5 THEN NOW() END, CASE WHEN $6 THEN NOW() END)`,
			f.campaign, contact, f.sequence, age.String(), i < bounced, i < complained); err != nil {
			t.Fatalf("progress: %v", err)
		}
	}
}

func (f *conductFixture) outcomes(t *testing.T, minSent int, window time.Duration) (OrgConduct, bool) {
	t.Helper()
	handle, _ := liveContactDB(t)
	rows, err := NewOrgConductRepository(handle).OrgRecipientOutcomes(context.Background(), minSent, window)
	if err != nil {
		t.Fatalf("OrgRecipientOutcomes: %v", err)
	}
	for _, r := range rows {
		if r.OrganizationID == f.org {
			return r, true
		}
	}
	return OrgConduct{}, false
}

func TestLiveOrgConductCountsOutcomesAgainstTheSameSends(t *testing.T) {
	f := newConductFixture(t)
	f.send(t, 120, 9, 2, time.Hour)

	got, ok := f.outcomes(t, 100, 30*24*time.Hour)
	if !ok {
		t.Fatal("the organization was not returned")
	}
	if got.Sent != 120 || got.Bounced != 9 || got.Complained != 2 {
		t.Errorf("got %d sent / %d bounced / %d complained, want 120/9/2",
			got.Sent, got.Bounced, got.Complained)
	}
}

// Below the floor a rate means nothing, so the organization is not returned at
// all rather than returned with a number the caller has to remember to ignore.
func TestLiveOrgConductHonoursTheSampleFloor(t *testing.T) {
	f := newConductFixture(t)
	f.send(t, 40, 40, 40, time.Hour)

	if _, ok := f.outcomes(t, 100, 30*24*time.Hour); ok {
		t.Error("40 sends were returned against a floor of 100")
	}
	if got, ok := f.outcomes(t, 10, 30*24*time.Hour); !ok || got.Sent != 40 {
		t.Errorf("got %v/%v, want the same rows under a lower floor", got, ok)
	}
}

// Sends outside the window are not the sends being judged.
func TestLiveOrgConductWindowsTheSends(t *testing.T) {
	f := newConductFixture(t)
	f.send(t, 30, 30, 0, 40*24*time.Hour)
	f.send(t, 20, 1, 0, time.Hour)

	got, ok := f.outcomes(t, 10, 30*24*time.Hour)
	if !ok {
		t.Fatal("the organization was not returned")
	}
	if got.Sent != 20 || got.Bounced != 1 {
		t.Errorf("got %d sent / %d bounced, want only the 20 recent sends", got.Sent, got.Bounced)
	}
}

// A row that was reserved but never sent is not a send.
func TestLiveOrgConductIgnoresUnsentRows(t *testing.T) {
	f := newConductFixture(t)
	f.send(t, 15, 0, 0, time.Hour)

	contact := uuid.New()
	ctx := context.Background()
	if _, err := f.pool.Exec(ctx,
		`INSERT INTO contacts (id, user_id, organization_id, email, first_name, last_name, company, phone, custom_fields, updated_at, created_at)
		 VALUES ($1, $2, $3, $4, 'C', 'D', '', '', '{}'::jsonb, NOW(), NOW())`,
		contact, f.user, f.org, "i245-"+contact.String()[:12]+"@test.local"); err != nil {
		t.Fatalf("contact: %v", err)
	}
	if _, err := f.pool.Exec(ctx,
		`INSERT INTO campaign_contact_progress (campaign_id, contact_id, sequence_id, dispatched_at)
		 VALUES ($1, $2, $3, NOW())`, f.campaign, contact, f.sequence); err != nil {
		t.Fatalf("progress: %v", err)
	}

	got, ok := f.outcomes(t, 10, 30*24*time.Hour)
	if !ok {
		t.Fatal("the organization was not returned")
	}
	if got.Sent != 15 {
		t.Errorf("sent = %d, want only the 15 rows that were actually sent", got.Sent)
	}
}
