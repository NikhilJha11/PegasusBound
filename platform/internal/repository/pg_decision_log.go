package repository

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/pegasusbound/pegasusbound/internal/infrastructure/db"
)

// DecisionLog is one automated action the system took (assignment,
// rebalance, quarantine, provisioning, IP rotation). Powers the admin
// "Decisions" page and post-hoc audit.
type DecisionLog struct {
	ID          int64
	Kind        string
	WorkerID    *uuid.UUID
	MailboxID   *uuid.UUID
	Before      json.RawMessage
	After       json.RawMessage
	Reason      string
	TriggeredBy string
	CreatedAt   time.Time
}

type DecisionLogRepository interface {
	Insert(ctx context.Context, d *DecisionLog) error
	ListRecent(ctx context.Context, kind string, limit int) ([]DecisionLog, error)
	ListForWorker(ctx context.Context, workerID uuid.UUID, limit int) ([]DecisionLog, error)
}

type decisionLogRepository struct{ db *db.DB }

func NewDecisionLogRepository(d *db.DB) DecisionLogRepository {
	return &decisionLogRepository{db: d}
}

func (r *decisionLogRepository) Insert(ctx context.Context, d *DecisionLog) error {
	const q = `
		INSERT INTO decision_log (kind, worker_id, mailbox_id, before, after, reason, triggered_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at
	`
	var before, after []byte
	if len(d.Before) > 0 {
		before = []byte(d.Before)
	}
	if len(d.After) > 0 {
		after = []byte(d.After)
	}
	return r.db.QueryRow(ctx, q, d.Kind, d.WorkerID, d.MailboxID, before, after, d.Reason, d.TriggeredBy).
		Scan(&d.ID, &d.CreatedAt)
}

func (r *decisionLogRepository) ListRecent(ctx context.Context, kind string, limit int) ([]DecisionLog, error) {
	if limit <= 0 {
		limit = 100
	}
	q := `SELECT id, kind, worker_id, mailbox_id, before, after, reason, triggered_by, created_at
	      FROM decision_log`
	args := []any{}
	if kind != "" {
		q += ` WHERE kind = $1 ORDER BY created_at DESC LIMIT $2`
		args = append(args, kind, limit)
	} else {
		q += ` ORDER BY created_at DESC LIMIT $1`
		args = append(args, limit)
	}
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DecisionLog
	for rows.Next() {
		var d DecisionLog
		var before, after []byte
		if err := rows.Scan(&d.ID, &d.Kind, &d.WorkerID, &d.MailboxID, &before, &after, &d.Reason, &d.TriggeredBy, &d.CreatedAt); err != nil {
			return nil, err
		}
		d.Before = before
		d.After = after
		out = append(out, d)
	}
	return out, rows.Err()
}

func (r *decisionLogRepository) ListForWorker(ctx context.Context, workerID uuid.UUID, limit int) ([]DecisionLog, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := r.db.Query(ctx,
		`SELECT id, kind, worker_id, mailbox_id, before, after, reason, triggered_by, created_at
		 FROM decision_log WHERE worker_id = $1 ORDER BY created_at DESC LIMIT $2`,
		workerID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DecisionLog
	for rows.Next() {
		var d DecisionLog
		var before, after []byte
		if err := rows.Scan(&d.ID, &d.Kind, &d.WorkerID, &d.MailboxID, &before, &after, &d.Reason, &d.TriggeredBy, &d.CreatedAt); err != nil {
			return nil, err
		}
		d.Before = before
		d.After = after
		out = append(out, d)
	}
	return out, rows.Err()
}
