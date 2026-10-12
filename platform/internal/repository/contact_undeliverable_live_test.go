package repository

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/pegasusbound/pegasusbound/internal/models"
)

// Issue #200: a lead the campaign will never send to must READ that way. It
// used to sit at "Queued" indefinitely, which is what made a wedged campaign
// look like a slow one.
//
//	PEGASUSBOUND_TEST_DB=postgres://pegasusbound:pegasusbound@localhost:15432/pegasusbound_dev?sslmode=disable \
//	  go test ./internal/repository/ -run LiveUndeliverable -v
func TestLiveUndeliverableLeadIsNotReportedAsQueued(t *testing.T) {
	handle, pool := liveContactDB(t)
	f := newSharedOrgFixture(t, pool)
	repo := NewContactRepostory(handle)
	ctx := context.Background()

	// A second contact, so one lead is undeliverable and one is genuinely queued.
	healthy := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO contacts (id, user_id, organization_id, email, first_name, last_name, company, phone, custom_fields, updated_at, created_at)
	      VALUES ($1, $2, $3, $4, 'Ada', 'Ng', '', '', '{}'::jsonb, NOW(), NOW())`,
		healthy, f.owner, f.org, "i200-"+healthy.String()[:8]+"@test.local"); err != nil {
		t.Fatalf("insert healthy contact: %v", err)
	}
	for _, c := range []uuid.UUID{f.contact, healthy} {
		if _, err := pool.Exec(ctx, `INSERT INTO campaign_leads (campaign_id, contact_id) VALUES ($1, $2)`,
			f.campaign, c); err != nil {
			t.Fatalf("add lead: %v", err)
		}
	}
	if _, err := pool.Exec(ctx,
		`UPDATE contacts SET verification_status = 'invalid', verification_reason = 'recipient rejected (550): 5.1.1 User unknown' WHERE id = $1`,
		f.contact); err != nil {
		t.Fatalf("mark invalid: %v", err)
	}

	res, xerr := repo.Search(ctx, f.org.String(), nil, nil, models.SearchContacts{
		CampaignIDs: []string{f.campaign.String()},
	}, 25)
	if xerr != nil {
		t.Fatalf("search: %v", xerr)
	}
	got := map[uuid.UUID]string{}
	for _, c := range res.Data {
		if c.CampaignLead != nil {
			got[c.ID] = c.CampaignLead.Status
		}
	}
	if got[f.contact] != models.LeadStatusUndeliverable {
		t.Fatalf("the unverifiable lead reads %q, want %q", got[f.contact], models.LeadStatusUndeliverable)
	}
	if got[healthy] != models.LeadStatusPending {
		t.Fatalf("the healthy lead reads %q, want %q", got[healthy], models.LeadStatusPending)
	}

	counts, xerr := repo.CampaignLeadCounts(ctx, f.org.String(), f.campaign.String())
	if xerr != nil {
		t.Fatalf("lead counts: %v", xerr)
	}
	if counts.Undeliverable != 1 || counts.Queued != 1 || counts.Total != 2 {
		t.Fatalf("counts undeliverable/queued/total = %d/%d/%d, want 1/1/2",
			counts.Undeliverable, counts.Queued, counts.Total)
	}

	// The Leads-view scope chips filter on the same derivation.
	filtered, xerr := repo.Search(ctx, f.org.String(), nil, nil, models.SearchContacts{
		CampaignIDs: []string{f.campaign.String()},
		LeadStatus:  models.LeadStatusUndeliverable,
	}, 25)
	if xerr != nil {
		t.Fatalf("filtered search: %v", xerr)
	}
	if len(filtered.Data) != 1 || filtered.Data[0].ID != f.contact {
		t.Fatalf("the undeliverable filter returned %d rows, want just the unverifiable lead", len(filtered.Data))
	}

	// A risky address is undeliverable only while the campaign refuses risky sending.
	if _, err := pool.Exec(ctx,
		`UPDATE contacts SET verification_status = 'risky' WHERE id = $1`, f.contact); err != nil {
		t.Fatalf("mark risky: %v", err)
	}
	counts, _ = repo.CampaignLeadCounts(ctx, f.org.String(), f.campaign.String())
	if counts.Undeliverable != 0 {
		t.Fatalf("risky counted as undeliverable while the campaign sends to risky addresses (%d)", counts.Undeliverable)
	}
	if _, err := pool.Exec(ctx, `UPDATE campaigns SET risky_emails = false WHERE id = $1`, f.campaign); err != nil {
		t.Fatalf("disable risky sending: %v", err)
	}
	counts, _ = repo.CampaignLeadCounts(ctx, f.org.String(), f.campaign.String())
	if counts.Undeliverable != 1 {
		t.Fatalf("risky not counted as undeliverable with the toggle off (%d)", counts.Undeliverable)
	}
}
