package intelsink

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Runs against a real database when INTELSINK_TEST_DB points at one with the
// platform migrations applied (e.g. the compose Postgres on :15432).
func TestRecordAppendsRelevantEvents(t *testing.T) {
	dsn := os.Getenv("INTELSINK_TEST_DB")
	if dsn == "" {
		t.Skip("INTELSINK_TEST_DB not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	org := uuid.New()
	sink := New(pool)
	sink.Record(ctx, org, "campaign.reply_received", map[string]any{"campaign_id": "c1", "contact_email": "a@b.test", "_body_text": "hello"})
	sink.Record(ctx, org, "contact.updated", map[string]any{"ignored": true}) // not relevant: dropped

	var n int
	var body string
	if err := pool.QueryRow(ctx, `SELECT count(*), max(data->>'_body_text') FROM intelligence_event_outbox WHERE organization_id = $1`, org).Scan(&n, &body); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM intelligence_event_outbox WHERE organization_id = $1`, org) })
	if n != 1 {
		t.Fatalf("expected 1 relevant event, got %d", n)
	}
	if body != "hello" {
		t.Fatalf("private reply body must reach the sink, got %q", body)
	}
}
