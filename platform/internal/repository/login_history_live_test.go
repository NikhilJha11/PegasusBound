package repository

import (
	"context"
	"net/mail"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Issue #149: a durable comparison window. Sign-ins were only ever a Redis
// device fingerprint with a TTL, so nothing recorded WHERE an account was used.
//
//	PEGASUSBOUND_TEST_DB=postgres://pegasusbound:pegasusbound@localhost:15432/pegasusbound_dev?sslmode=disable \
//	  go test ./internal/repository/ -run LiveLoginHistory -v

func newLoginUser(t *testing.T) (LoginHistoryRepository, uuid.UUID) {
	t.Helper()
	handle, pool := liveContactDB(t)
	addr, err := mail.ParseAddress("login-" + uuid.New().String()[:8] + "@test.local")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	u, err := NewUserRepostory(handle, nil).CreateUser(context.Background(), addr, "hash")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		// login_history cascades on the user, so deleting the user is enough.
		if _, err := pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, u.ID); err != nil {
			t.Errorf("cleanup user: %v", err)
		}
	})
	return NewLoginHistoryRepository(handle), u.ID
}

func TestLiveLoginHistoryRoundTrips(t *testing.T) {
	repo, id := newLoginUser(t)
	ctx := context.Background()

	if prev, err := repo.LastLogin(ctx, id); err != nil || prev != nil {
		t.Fatalf("a new account should have no history: prev=%v err=%v", prev, err)
	}

	if err := repo.RecordLogin(ctx, id, LoginRecord{
		IP: "203.0.113.5", UserAgent: "Mozilla/5.0", CountryCode: "GB",
		Latitude: 51.5074, Longitude: -0.1278,
	}); err != nil {
		t.Fatalf("RecordLogin: %v", err)
	}

	prev, err := repo.LastLogin(ctx, id)
	if err != nil || prev == nil {
		t.Fatalf("LastLogin: %v %v", prev, err)
	}
	if prev.IP != "203.0.113.5" || prev.CountryCode != "GB" {
		t.Errorf("record = %+v", prev)
	}
	if prev.Latitude < 51.5 || prev.Latitude > 51.6 {
		t.Errorf("latitude = %v, want it preserved for the distance check", prev.Latitude)
	}
}

// The window is bounded: this is a comparison buffer, not a second audit log.
func TestLiveLoginHistoryIsBounded(t *testing.T) {
	repo, id := newLoginUser(t)
	ctx := context.Background()
	_, pool := liveContactDB(t)

	for i := 0; i < loginHistoryKeep+15; i++ {
		if err := repo.RecordLogin(ctx, id, LoginRecord{IP: "203.0.113.5", CountryCode: "GB"}); err != nil {
			t.Fatalf("RecordLogin %d: %v", i, err)
		}
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM login_history WHERE user_id = $1`, id).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n > loginHistoryKeep {
		t.Errorf("%d rows retained, want at most %d", n, loginHistoryKeep)
	}
}

// An unparseable address must not lose the rest of the record.
func TestLiveLoginHistoryToleratesABadAddress(t *testing.T) {
	repo, id := newLoginUser(t)
	ctx := context.Background()

	if err := repo.RecordLogin(ctx, id, LoginRecord{IP: "not-an-ip", CountryCode: "GB"}); err != nil {
		t.Fatalf("RecordLogin: %v", err)
	}
	prev, err := repo.LastLogin(ctx, id)
	if err != nil || prev == nil {
		t.Fatalf("LastLogin: %v %v", prev, err)
	}
	if prev.IP != "" {
		t.Errorf("ip = %q, want empty", prev.IP)
	}
	if prev.CountryCode != "GB" {
		t.Error("the rest of the record was lost")
	}
}

func TestLiveLoginHistoryCountsFlagged(t *testing.T) {
	repo, id := newLoginUser(t)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		if err := repo.RecordLogin(ctx, id, LoginRecord{
			IP: "203.0.113.5", Flagged: true, FlagReason: "impossible travel",
		}); err != nil {
			t.Fatalf("RecordLogin: %v", err)
		}
	}
	if err := repo.RecordLogin(ctx, id, LoginRecord{IP: "203.0.113.5"}); err != nil {
		t.Fatalf("RecordLogin: %v", err)
	}

	n, err := repo.CountFlaggedSince(ctx, id, time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatalf("CountFlaggedSince: %v", err)
	}
	if n != 3 {
		t.Errorf("flagged = %d, want 3; the clean sign-in must not count", n)
	}
	// A window that starts in the future sees nothing.
	if n, err := repo.CountFlaggedSince(ctx, id, time.Now().Add(time.Hour)); err != nil || n != 0 {
		t.Errorf("out-of-window count = %d err=%v, want 0", n, err)
	}
}
