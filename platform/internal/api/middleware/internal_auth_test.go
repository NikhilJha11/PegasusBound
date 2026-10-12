package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// resetInternalToken lets tests rerun the env-var lookup. Production code
// only loads the env once via sync.Once.
func resetInternalToken(t *testing.T, value string) {
	t.Helper()
	t.Setenv("INTERNAL_API_TOKEN", value)
	// Bypass sync.Once by writing the cached token directly.
	internalToken = []byte(value)
	internalTokenOnce.Do(func() {}) // mark Once as fired so loadInternalToken is skipped
}

func newRouterWithInternalAuth(t *testing.T) *gin.Engine {
	t.Helper()
	h := &Handler{}
	r := gin.New()
	r.GET("/internal/ping", h.InternalAuthMiddleware(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	return r
}

func TestInternalAuth_RejectsMissingHeader(t *testing.T) {
	resetInternalToken(t, "secret")
	r := newRouterWithInternalAuth(t)

	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), "GET", "/internal/ping", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("missing header should be 401, got %d", w.Code)
	}
}

func TestInternalAuth_RejectsWrongScheme(t *testing.T) {
	resetInternalToken(t, "secret")
	r := newRouterWithInternalAuth(t)

	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), "GET", "/internal/ping", nil)
	req.Header.Set("Authorization", "Basic secret")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("Basic should be 401, got %d", w.Code)
	}
}

func TestInternalAuth_RejectsWrongToken(t *testing.T) {
	resetInternalToken(t, "secret")
	r := newRouterWithInternalAuth(t)

	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), "GET", "/internal/ping", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("wrong token should be 401, got %d", w.Code)
	}
}

func TestInternalAuth_AcceptsCorrectToken(t *testing.T) {
	resetInternalToken(t, "secret")
	r := newRouterWithInternalAuth(t)

	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), "GET", "/internal/ping", nil)
	req.Header.Set("Authorization", "Bearer secret")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("correct token should be 200, got %d (body=%s)", w.Code, w.Body.String())
	}
}

func TestInternalAuth_FailsClosedWhenTokenUnset(t *testing.T) {
	// Explicitly empty: the middleware MUST refuse rather than allow.
	resetInternalToken(t, "")
	internalToken = nil // simulate unconfigured server
	r := newRouterWithInternalAuth(t)

	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), "GET", "/internal/ping", nil)
	req.Header.Set("Authorization", "Bearer anything")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("unconfigured server must reject, got %d", w.Code)
	}
}
