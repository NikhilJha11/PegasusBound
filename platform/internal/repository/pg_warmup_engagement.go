package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PendingEngagement is a delayed warmup engagement action awaiting its dwell.
// Payload is a JSON-encoded models.WarmupEmailAction (the delayed leg, with
// DelaySeconds already consumed — the worker runs it immediately on receipt).
type PendingEngagement struct {
	ID             uuid.UUID
	EmailAccountID uuid.UUID
	Payload        []byte
	FireAt         time.Time
}

// WarmupEngagementRepository is the durable schedule for dwell-delayed warmup
// engagement actions, so a worker restart can't drop them (the old in-process
// timer did). Control-plane only; drained by the consumer-side poller.
type WarmupEngagementRepository interface {
	// EnqueuePendingEngagement stores a delayed engagement leg to fire at fireAt.
	EnqueuePendingEngagement(ctx context.Context, accountID uuid.UUID, payload []byte, fireAt time.Time) error
	// ClaimDuePendingEngagements atomically removes and returns up to limit rows
	// whose fire_at has passed, so each is delivered exactly once across pollers.
	ClaimDuePendingEngagements(ctx context.Context, limit int) ([]PendingEngagement, error)
}

type warmupEngagementRepository struct {
	db *pgxpool.Pool
}

// NewWarmupEngagementRepository creates a new warmup engagement repository.
func NewWarmupEngagementRepository(db *pgxpool.Pool) WarmupEngagementRepository {
	return &warmupEngagementRepository{db: db}
}

func (r *warmupEngagementRepository) EnqueuePendingEngagement(ctx context.Context, accountID uuid.UUID, payload []byte, fireAt time.Time) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO warmup_pending_engagements (email_account_id, payload, fire_at) VALUES ($1, $2, $3)`,
		accountID, payload, fireAt)
	return err
}

// ClaimDuePendingEngagements uses DELETE ... RETURNING over a FOR UPDATE SKIP
// LOCKED subselect so concurrent pollers never claim the same row and a claimed
// row is removed in the same statement (delivered at most once).
func (r *warmupEngagementRepository) ClaimDuePendingEngagements(ctx context.Context, limit int) ([]PendingEngagement, error) {
	if limit <= 0 {
		limit = 100
	}
	query := `
		DELETE FROM warmup_pending_engagements
		WHERE id IN (
			SELECT id FROM warmup_pending_engagements
			WHERE fire_at <= NOW()
			ORDER BY fire_at
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING id, email_account_id, payload, fire_at
	`
	rows, err := r.db.Query(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []PendingEngagement
	for rows.Next() {
		var p PendingEngagement
		if err := rows.Scan(&p.ID, &p.EmailAccountID, &p.Payload, &p.FireAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
