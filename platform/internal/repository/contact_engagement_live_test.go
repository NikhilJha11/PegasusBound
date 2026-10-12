package repository

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pegasusbound/pegasusbound/internal/models"
)

// Issue #250: the campaign Leads view filters by who opened, clicked and
// replied on the server, so counts and pagination hold across pages. These
// prove each `engagement` value, that a machine open is not an open, and that
// "not opened" means sent-but-unopened rather than never-sent.
//
//	PEGASUSBOUND_TEST_DB=postgres://pegasusbound:pegasusbound@localhost:15432/pegasusbound_dev?sslmode=disable \
//	  go test ./internal/repository/ -run LiveContactEngagement -v

type engagementLeads struct {
	opened, machineOpened, clicked, replied, bounced, sentOnly, neverSent uuid.UUID
}

// seedEngagementLeads adds one email step and one lead per engagement shape.
func seedEngagementLeads(t *testing.T, f *sharedOrgFixture, pool *pgxpool.Pool) engagementLeads {
	t.Helper()
	ctx := context.Background()
	step := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO sequences (id, campaign_id, organization_id, name, subject,
	          body_plain, body_html, wait_after, position, kind)
	      VALUES ($1, $2, $3, 'Step 1', 'Hi', 'Hello', '<p>Hello</p>', 0, 1, 'email')`, step, f.campaign, f.org); err != nil {
		t.Fatalf("sequence: %v", err)
	}
	l := engagementLeads{
		opened:        addLead(t, f, "opened-"+uuid.New().String()[:6]+"@test.local", "valid", true),
		machineOpened: addLead(t, f, "machine-"+uuid.New().String()[:6]+"@test.local", "valid", true),
		clicked:       addLead(t, f, "clicked-"+uuid.New().String()[:6]+"@test.local", "valid", true),
		replied:       addLead(t, f, "replied-"+uuid.New().String()[:6]+"@test.local", "valid", true),
		bounced:       addLead(t, f, "bounced-"+uuid.New().String()[:6]+"@test.local", "valid", true),
		sentOnly:      addLead(t, f, "sent-"+uuid.New().String()[:6]+"@test.local", "valid", true),
		neverSent:     addLead(t, f, "queued-"+uuid.New().String()[:6]+"@test.local", "valid", true),
	}
	progress := func(contact uuid.UUID, cols string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `INSERT INTO campaign_contact_progress (campaign_id, contact_id, sequence_id, sent_at`+cols+`)`,
			f.campaign, contact, step); err != nil {
			t.Fatalf("progress %q: %v", cols, err)
		}
	}
	progress(l.opened, `, opened_at) VALUES ($1, $2, $3, NOW() - INTERVAL '1 hour', NOW()`)
	progress(l.machineOpened, `, opened_at, opened_machine) VALUES ($1, $2, $3, NOW() - INTERVAL '1 hour', NOW(), true`)
	// A click implies an open on the same step, as the tracking consumer records it.
	progress(l.clicked, `, opened_at, clicked_at) VALUES ($1, $2, $3, NOW() - INTERVAL '1 hour', NOW(), NOW()`)
	progress(l.replied, `, replied_at) VALUES ($1, $2, $3, NOW() - INTERVAL '1 hour', NOW()`)
	progress(l.bounced, `, bounced_at) VALUES ($1, $2, $3, NOW() - INTERVAL '1 hour', NOW()`)
	progress(l.sentOnly, `) VALUES ($1, $2, $3, NOW() - INTERVAL '1 hour'`)
	return l
}

func searchEngagement(t *testing.T, repo *contactRepository, f *sharedOrgFixture, filters models.SearchContacts) map[uuid.UUID]models.Contact {
	t.Helper()
	filters.CampaignIDs = []string{f.campaign.String()}
	res, err := repo.Search(context.Background(), f.org.String(), nil, nil, filters, 100)
	if err != nil {
		t.Fatalf("Search(%+v): %v", filters, err)
	}
	out := make(map[uuid.UUID]models.Contact, len(res.Data))
	for _, c := range res.Data {
		out[c.ID] = c
	}
	return out
}

func TestLiveContactEngagementFilters(t *testing.T) {
	handle, pool := liveContactDB(t)
	f := newSharedOrgFixture(t, pool)
	l := seedEngagementLeads(t, f, pool)
	repo := &contactRepository{DB: handle}

	cases := []struct {
		engagement string
		want       []uuid.UUID
	}{
		// A machine open is not an open, but the click lead's open is human.
		{models.LeadEngagementOpened, []uuid.UUID{l.opened, l.clicked}},
		// Sent but no human open; the never-sent lead is excluded.
		{models.LeadEngagementNotOpened, []uuid.UUID{l.machineOpened, l.replied, l.bounced, l.sentOnly}},
		{models.LeadEngagementClicked, []uuid.UUID{l.clicked}},
		{models.LeadEngagementNotClicked, []uuid.UUID{l.opened, l.machineOpened, l.replied, l.bounced, l.sentOnly}},
		{models.LeadEngagementReplied, []uuid.UUID{l.replied}},
		{models.LeadEngagementNotReplied, []uuid.UUID{l.opened, l.machineOpened, l.clicked, l.bounced, l.sentOnly}},
		{models.LeadEngagementBounced, []uuid.UUID{l.bounced}},
	}
	// Every seeded lead, plus the fixture's own contact (a lead in no campaign
	// here, so never returned by a campaign-scoped search).
	all := []uuid.UUID{l.opened, l.machineOpened, l.clicked, l.replied, l.bounced, l.sentOnly, l.neverSent}
	for _, tc := range cases {
		got := searchEngagement(t, repo, f, models.SearchContacts{Engagement: tc.engagement})
		want := map[uuid.UUID]bool{}
		for _, id := range tc.want {
			want[id] = true
		}
		for _, id := range all {
			if _, ok := got[id]; ok != want[id] {
				t.Errorf("engagement=%s: lead %s returned=%v, want %v", tc.engagement, id, ok, want[id])
			}
		}
		if len(got) != len(tc.want) {
			t.Errorf("engagement=%s: %d rows, want %d", tc.engagement, len(got), len(tc.want))
		}
	}

	// The per-lead aggregate follows the same definition of an open.
	got := searchEngagement(t, repo, f, models.SearchContacts{})
	if lead := got[l.machineOpened].CampaignLead; lead == nil || lead.Opened != 0 || lead.MachineOpened != 1 {
		t.Errorf("machine-opened lead aggregate = %+v, want opened=0 machine_opened=1", lead)
	}
	if lead := got[l.opened].CampaignLead; lead == nil || lead.Opened != 1 || lead.MachineOpened != 0 {
		t.Errorf("opened lead aggregate = %+v, want opened=1 machine_opened=0", lead)
	}

	// Engagement composes with lead_status as AND.
	got = searchEngagement(t, repo, f, models.SearchContacts{LeadStatus: models.LeadStatusReplied, Engagement: models.LeadEngagementNotOpened})
	if len(got) != 1 || got[l.replied].ID != l.replied {
		t.Errorf("replied AND not_opened returned %d rows, want only the replied lead", len(got))
	}
	got = searchEngagement(t, repo, f, models.SearchContacts{LeadStatus: models.LeadStatusReplied, Engagement: models.LeadEngagementOpened})
	if len(got) != 0 {
		t.Errorf("replied AND opened returned %d rows, want 0", len(got))
	}

	// The campaign-wide totals the Leads chips show match the filters.
	counts, err := repo.CampaignLeadCounts(context.Background(), f.org.String(), f.campaign.String())
	if err != nil {
		t.Fatalf("CampaignLeadCounts: %v", err)
	}
	if counts.Contacted != 6 || counts.Opened != 2 || counts.Clicked != 1 || counts.RepliedAny != 1 {
		t.Errorf("lead counts = contacted %d opened %d clicked %d replied_any %d, want 6/2/1/1",
			counts.Contacted, counts.Opened, counts.Clicked, counts.RepliedAny)
	}
}
