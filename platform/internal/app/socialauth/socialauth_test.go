package socialauth

import (
	"net/url"
	"strings"
	"testing"

	"github.com/pegasusbound/pegasusbound/internal/pkg/idtoken"
)

func TestNewGoogleRequiresBothHalvesOfTheClient(t *testing.T) {
	tests := []struct {
		name                                string
		clientID, clientSecret, redirectURL string
	}{
		{"no id", "", "secret", "https://api.example.com/v1/auth/google/callback"},
		{"no secret", "id", "", "https://api.example.com/v1/auth/google/callback"},
		{"no redirect", "id", "secret", ""},
		{"relative redirect", "id", "secret", "/v1/auth/google/callback"},
	}

	for _, tt := range tests {
		if _, err := NewGoogle(tt.clientID, tt.clientSecret, tt.redirectURL); err == nil {
			t.Errorf("%s: expected an error, got a usable provider", tt.name)
		}
	}
}

// The authorization request is the half an operator cannot inspect, so every
// parameter the flow depends on later is asserted here: without the challenge
// the exchange is refused, and without the nonce the returned ID token cannot
// be bound to this attempt.
func TestGoogleAuthCodeURLCarriesPKCEAndNonce(t *testing.T) {
	g, err := NewGoogle("client-id", "client-secret", "https://api.example.com/v1/auth/google/callback")
	if err != nil {
		t.Fatal(err)
	}

	raw := g.AuthCodeURL("state-value", "nonce-value", "verifier-value")
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()

	if got := q.Get("client_id"); got != "client-id" {
		t.Errorf("client_id = %q", got)
	}
	if got := q.Get("redirect_uri"); got != "https://api.example.com/v1/auth/google/callback" {
		t.Errorf("redirect_uri = %q", got)
	}
	if got := q.Get("state"); got != "state-value" {
		t.Errorf("state = %q", got)
	}
	if got := q.Get("nonce"); got != "nonce-value" {
		t.Errorf("nonce = %q", got)
	}
	if got := q.Get("code_challenge_method"); got != "S256" {
		t.Errorf("code_challenge_method = %q", got)
	}
	// The challenge is the hash of the verifier, never the verifier itself.
	if got := q.Get("code_challenge"); got == "" || got == "verifier-value" {
		t.Errorf("code_challenge = %q, want the S256 hash of the verifier", got)
	}
	if got := q.Get("prompt"); got != "select_account" {
		t.Errorf("prompt = %q, want select_account so a shared browser does not silently reuse an account", got)
	}
	if scope := q.Get("scope"); !strings.Contains(scope, "openid") || !strings.Contains(scope, "email") {
		t.Errorf("scope = %q, want openid and email", scope)
	}
}

func TestNewAppleRefusesPlainHTTPRedirect(t *testing.T) {
	if _, err := NewApple(stubAppleClient{}, "com.example.service", "http://localhost:8080/v1/auth/apple/callback"); err == nil {
		t.Fatal("expected an error: Apple refuses a plain-http return URL")
	}
	if _, err := NewApple(nil, "com.example.service", "https://api.example.com/v1/auth/apple/callback"); err == nil {
		t.Fatal("expected an error when the Apple client is not configured")
	}
	if _, err := NewApple(stubAppleClient{}, "", "https://api.example.com/v1/auth/apple/callback"); err == nil {
		t.Fatal("expected an error when the Services ID is missing")
	}
}

// Apple only puts the email claim in the ID token when the email scope is
// requested, and any scope forces form_post. Losing either turns first sign-in
// into an account with no address.
func TestAppleAuthCodeURLRequestsEmailByFormPost(t *testing.T) {
	a, err := NewApple(stubAppleClient{}, "com.example.service", "https://api.example.com/v1/auth/apple/callback")
	if err != nil {
		t.Fatal(err)
	}

	u, err := url.Parse(a.AuthCodeURL("state-value", "nonce-value", "verifier-value"))
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()

	if got := q.Get("response_mode"); got != "form_post" {
		t.Errorf("response_mode = %q", got)
	}
	if got := q.Get("response_type"); got != "code" {
		t.Errorf("response_type = %q", got)
	}
	if scope := q.Get("scope"); !strings.Contains(scope, "email") {
		t.Errorf("scope = %q, want the email scope", scope)
	}
	if got := q.Get("nonce"); got != "nonce-value" {
		t.Errorf("nonce = %q", got)
	}
	if got := q.Get("state"); got != "state-value" {
		t.Errorf("state = %q", got)
	}
}

func TestCheckIdentityRejectsWhatTheProviderDoesNotVouchFor(t *testing.T) {
	valid := func() *idtoken.Claims {
		return &idtoken.Claims{Subject: "sub", Email: "person@example.com", EmailVerified: true, Nonce: "n"}
	}

	if err := checkIdentity(valid(), "n"); err != nil {
		t.Fatalf("a complete, verified identity was rejected: %v", err)
	}

	replayed := valid()
	replayed.Nonce = "someone-elses-nonce"
	if err := checkIdentity(replayed, "n"); err == nil {
		t.Error("a token minted for another authorization request was accepted")
	}
	if err := checkIdentity(valid(), ""); err == nil {
		t.Error("an empty expected nonce was accepted, which would make the check a no-op")
	}

	unverified := valid()
	unverified.EmailVerified = false
	if err := checkIdentity(unverified, "n"); err == nil {
		t.Error("an unverified address was accepted")
	}

	noSubject := valid()
	noSubject.Subject = ""
	if err := checkIdentity(noSubject, "n"); err == nil {
		t.Error("a token with no subject was accepted")
	}

	noEmail := valid()
	noEmail.Email = ""
	if err := checkIdentity(noEmail, "n"); err == nil {
		t.Error("a token with no email claim was accepted")
	}
}
