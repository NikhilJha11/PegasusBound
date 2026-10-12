package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/pegasusbound/pegasusbound/internal/infrastructure/db"
)

// EmailHistoryIDRepository persists the per-mailbox Gmail history cursor. The
// consumer owns Postgres, so this is a plain Postgres repository (previously a
// DynamoDB table).
type EmailHistoryIDRepository interface {
	Put(ctx context.Context, userID, emailID uuid.UUID, historyID uint64) error
	Get(ctx context.Context, userID, emailID uuid.UUID) (*EmailHistoryIDData, error)
}

// EmailHistoryIDData is one per-mailbox Gmail history cursor.
type EmailHistoryIDData struct {
	UserID        string
	EmailID       string
	HistoryID     uint64
	LastUpdatedAt time.Time
}

type pgEmailHistoryIDRepository struct {
	db *db.DB
}

func NewEmailHistoryIDRepository(d *db.DB) EmailHistoryIDRepository {
	return &pgEmailHistoryIDRepository{db: d}
}

func (r *pgEmailHistoryIDRepository) Put(ctx context.Context, userID, emailID uuid.UUID, historyID uint64) error {
	const q = `
		INSERT INTO email_history_ids (user_id, email_id, history_id, last_updated_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT (user_id, email_id)
		DO UPDATE SET history_id = EXCLUDED.history_id, last_updated_at = now()
	`
	// Gmail history IDs are a monotonic counter well within int64 range.
	if _, err := r.db.Exec(ctx, q, userID, emailID, int64(historyID)); err != nil {
		return fmt.Errorf("email_history_ids: put: %w", err)
	}
	return nil
}

func (r *pgEmailHistoryIDRepository) Get(ctx context.Context, userID, emailID uuid.UUID) (*EmailHistoryIDData, error) {
	const q = `
		SELECT history_id, last_updated_at
		FROM email_history_ids
		WHERE user_id = $1 AND email_id = $2
	`
	var historyID int64
	var lastUpdated time.Time
	err := r.db.QueryRow(ctx, q, userID, emailID).Scan(&historyID, &lastUpdated)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("email_history_ids: get: %w", err)
	}
	return &EmailHistoryIDData{
		UserID:        userID.String(),
		EmailID:       emailID.String(),
		HistoryID:     uint64(historyID),
		LastUpdatedAt: lastUpdated,
	}, nil
}
