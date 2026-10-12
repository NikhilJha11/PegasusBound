package handler

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/pegasusbound/pegasusbound/internal/api/middleware"
	"github.com/pegasusbound/pegasusbound/internal/app/intelsink"
)

// The intelligence service (experiments, learning, memory, Company Brain and
// CRM connections) runs as a private sidecar. The dashboard reaches it through
// /v1/intel/*: this backend authenticates the session and organization as for
// every other route, then forwards the request with a signed identity the
// sidecar verifies. The sidecar is never exposed publicly.

const (
	intelHeaderOrg   = "X-Intel-Org"
	intelHeaderUser  = "X-Intel-User"
	intelHeaderPerms = "X-Intel-Perms"
	intelHeaderTS    = "X-Intel-Ts"
	intelHeaderSig   = "X-Intel-Sig"
)

func intelligenceTarget() (*url.URL, bool) {
	raw := strings.TrimSpace(os.Getenv("INTELLIGENCE_URL"))
	if raw == "" || !intelsink.Enabled() {
		return nil, false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return nil, false
	}
	return u, true
}

// SignIntelIdentity is the HMAC the sidecar recomputes: org|user|perms|ts.
func SignIntelIdentity(secret, org, user, perms, ts string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(org + "|" + user + "|" + perms + "|" + ts))
	return hex.EncodeToString(mac.Sum(nil))
}

func intelProxy(c *gin.Context, target *url.URL, path string, identity map[string]string) {
	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(target)
			r.Out.URL.Path = strings.TrimRight(target.Path, "/") + path
			r.Out.URL.RawPath = ""
			r.Out.URL.RawQuery = c.Request.URL.RawQuery
			r.Out.Header.Del("Cookie")
			// Never trust identity headers from the client.
			for _, h := range []string{intelHeaderOrg, intelHeaderUser, intelHeaderPerms, intelHeaderTS, intelHeaderSig} {
				r.Out.Header.Del(h)
			}
			for k, v := range identity {
				r.Out.Header.Set(k, v)
			}
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_, _ = fmt.Fprintf(w, `{"error":"intelligence service unavailable"}`)
		},
	}
	proxy.ServeHTTP(c.Writer, c.Request)
}

// ProxyIntelligence forwards an authenticated dashboard request to the sidecar.
func (h *Handler) ProxyIntelligence(c *gin.Context) {
	target, ok := intelligenceTarget()
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "intelligence is not enabled on this deployment"})
		return
	}
	orgID := middleware.GetOrganizationID(c)
	if orgID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no organization selected"})
		return
	}
	secret := os.Getenv("INTERNAL_API_TOKEN")
	if secret == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "INTERNAL_API_TOKEN is not configured"})
		return
	}
	perms := "0"
	if p, ok := middleware.GetMemberPermissions(c); ok {
		perms = strconv.FormatUint(uint64(p), 10)
	}
	org, user := orgID.String(), middleware.GetUserID(c)
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	intelProxy(c, target, "/api"+c.Param("path"), map[string]string{
		intelHeaderOrg:   org,
		intelHeaderUser:  user,
		intelHeaderPerms: perms,
		intelHeaderTS:    ts,
		intelHeaderSig:   SignIntelIdentity(secret, org, user, perms, ts),
	})
}

// ProxyIntelligenceOAuthCallback forwards an MCP provider's OAuth redirect.
// It carries no session (it's a browser redirect from the provider); the
// sidecar validates the one-time state it issued.
func (h *Handler) ProxyIntelligenceOAuthCallback(c *gin.Context) {
	target, ok := intelligenceTarget()
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "intelligence is not enabled on this deployment"})
		return
	}
	c.Request.Header.Del("Authorization")
	intelProxy(c, target, "/oauth/callback", nil)
}
