package repository

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// GetSequencesByCampaignID did not select `kind`, so every step came back
// looking like an email. Preflight's content check then scored wait and action
// nodes as copy and reported their empty subject and body as the campaign's
// worst content.
//
//	PEGASUSBOUND_TEST_DB=postgres://pegasusbound:pegasusbound@localhost:15432/pegasusbound_dev?sslmode=disable \
//	  go test ./internal/repository/ -run LiveSequenceKind -v
func TestLiveSequenceKindSurvivesTheRoundTrip(t *testing.T) {
	handle, pool := liveContactDB(t)
	f := newSharedOrgFixture(t, pool)
	repo := NewCampaignRepostory(handle)
	ctx := context.Background()

	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(),
			`DELETE FROM sequences WHERE campaign_id = $1`, f.campaign); err != nil {
			t.Errorf("cleanup sequences: %v", err)
		}
	})

	for _, step := range []struct {
		pos  int
		kind string
		name string
	}{{0, "email", "Intro"}, {1, "wait", "Hold"}, {2, "action", "Tag"}} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO sequences (id, campaign_id, organization_id, name, subject, body_plain, body_html, wait_after, position, kind)
			 VALUES ($1, $2, $3, $4, '', '', '', 0, $5, $6)`,
			uuid.New(), f.campaign, f.org, step.name, step.pos, step.kind); err != nil {
			t.Fatalf("insert %s step: %v", step.kind, err)
		}
	}

	seqs, err := repo.GetSequencesByCampaignID(ctx, f.campaign)
	if err != nil {
		t.Fatalf("get sequences: %v", err)
	}
	if len(seqs) != 3 {
		t.Fatalf("got %d steps, want 3", len(seqs))
	}
	for i, want := range []string{"email", "wait", "action"} {
		if seqs[i].Kind != want {
			t.Errorf("step %d kind = %q, want %q", i, seqs[i].Kind, want)
		}
	}
}
