package repository

import (
	"context"
	"errors"
	"net"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/pegasusbound/pegasusbound/internal/infrastructure/db"
)

// LoginRecord is one observed sign-in.
type LoginRecord struct {
	IP          string
	UserAgent   string
	City        string
	CountryCode string
	Latitude    float64
	Longitude   float64
	Flagged     bool
	FlagReason  string
	CreatedAt   time.Time
}

// LoginHistoryRepository keeps a bounded window of recent sign-in locations.
type LoginHistoryRepository interface {
	// LastLogin returns the user's most recent recorded sign-in, or nil when
	// there is none to compare against.
	LastLogin(ctx context.Context, userID uuid.UUID) (*LoginRecord, error)
	// RecordLogin appends a sign-in and trims the user's window, so this stays
	// a comparison buffer rather than an unbounded log.
	RecordLogin(ctx context.Context, userID uuid.UUID, rec LoginRecord) error
	// CountFlaggedSince counts anomalous sign-ins in a window, which is what
	// makes a pattern distinguishable from one odd trip.
	CountFlaggedSince(ctx context.Context, userID uuid.UUID, since time.Time) (int, error)
}

// loginHistoryKeep is how many sign-ins per user are retained. Enough to see a
// pattern, few enough that this never becomes a second audit log.
const loginHistoryKeep = 20

type loginHistoryRepository struct {
	DB *db.DB
}

func NewLoginHistoryRepository(database *db.DB) LoginHistoryRepository {
	return &loginHistoryRepository{DB: database}
}

func (r *loginHistoryRepository) LastLogin(ctx context.Context, userID uuid.UUID) (*LoginRecord, error) {
	var (
		rec          LoginRecord
		ip, city, cc *string
		lat, lon     *float64
	)
	err := r.DB.Pool.QueryRow(ctx, `
		SELECT host(ip), city, country_code, latitude, longitude, created_at
		  FROM login_history WHERE user_id = $1
		 ORDER BY created_at DESC LIMIT 1
	`, userID).Scan(&ip, &city, &cc, &lat, &lon, &rec.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if ip != nil {
		rec.IP = *ip
	}
	if city != nil {
		rec.City = *city
	}
	if cc != nil {
		rec.CountryCode = *cc
	}
	if lat != nil {
		rec.Latitude = *lat
	}
	if lon != nil {
		rec.Longitude = *lon
	}
	return &rec, nil
}

func (r *loginHistoryRepository) RecordLogin(ctx context.Context, userID uuid.UUID, rec LoginRecord) error {
	tx, err := r.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// An unparseable address is stored as NULL rather than failing the write:
	// the rest of the record is still worth comparing against.
	var addr any
	if parsed := net.ParseIP(strings.TrimSpace(rec.IP)); parsed != nil {
		addr = parsed.String()
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO login_history
		    (user_id, ip, user_agent, city, country_code, latitude, longitude, flagged, flag_reason)
		VALUES ($1, $2::inet, NULLIF($3,''), NULLIF($4,''), NULLIF($5,''),
		        -- Cast explicitly: comparing against a bare 0 makes Postgres
		        -- infer an integer parameter and silently truncate the
		        -- coordinate, which would corrupt every distance computed
		        -- from it.
		        NULLIF($6::double precision, 0), NULLIF($7::double precision, 0),
		        $8, NULLIF($9,''))
	`, userID, addr, truncate(rec.UserAgent, 512), rec.City, rec.CountryCode,
		rec.Latitude, rec.Longitude, rec.Flagged, rec.FlagReason); err != nil {
		return err
	}

	// Trim to the comparison window.
	if _, err := tx.Exec(ctx, `
		DELETE FROM login_history
		 WHERE user_id = $1
		   AND id NOT IN (
		       SELECT id FROM login_history WHERE user_id = $1
		        ORDER BY created_at DESC LIMIT $2
		   )
	`, userID, loginHistoryKeep); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *loginHistoryRepository) CountFlaggedSince(ctx context.Context, userID uuid.UUID, since time.Time) (int, error) {
	var n int
	err := r.DB.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM login_history WHERE user_id = $1 AND flagged AND created_at >= $2`,
		userID, since).Scan(&n)
	return n, err
}
