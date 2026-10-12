// Package intelsink hands platform events to the Pegasusbound intelligence
// service (experiments, learning, memory). Events are appended to a durable
// outbox table in the shared database; the intelligence service drains it.
// Nothing leaves the deployment's private network.
package intelsink

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/pegasusbound/pegasusbound/internal/models"
)

// Events the intelligence layer learns from. Everything else is ignored so the
// outbox stays small.
var relevant = map[models.WebhookEventType]bool{
	"campaign.email_sent":             true,
	"campaign.email_delivered":        true,
	"campaign.email_bounced":          true,
	"campaign.reply_received":         true,
	"campaign.unsubscribed":           true,
	"campaign.completed":              true,
	"campaign.paused":                 true,
	"campaign.deliverability_warning": true,
	"deliverability.bounce":           true,
	"deliverability.complaint":        true,
	"inbox.reply_received":            true,
	"meeting.booked":                  true,
	"meeting.canceled":                true,
	"meeting.rescheduled":             true,
}

// Enabled reports whether the intelligence layer is switched on for this deployment.
func Enabled() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("INTELLIGENCE_ENABLED")), "true")
}

type Sink struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Sink { return &Sink{pool: pool} }

// Record matches webhook.DispatchSink. It never blocks the caller for long and
// never fails the originating operation.
func (s *Sink) Record(ctx context.Context, orgID uuid.UUID, eventType models.WebhookEventType, data any) {
	if s == nil || s.pool == nil || !relevant[eventType] {
		return
	}
	body, err := json.Marshal(data)
	if err != nil {
		log.Warn().Err(err).Str("event_type", string(eventType)).Msg("intelsink: marshal event")
		return
	}
	writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	if _, err := s.pool.Exec(writeCtx,
		`INSERT INTO intelligence_event_outbox (organization_id, event_type, data) VALUES ($1, $2, $3)`,
		orgID, string(eventType), body,
	); err != nil {
		log.Warn().Err(err).Str("event_type", string(eventType)).Msg("intelsink: append event")
	}
}
