package main

import "testing"

// The provider returns the browser to a route the API serves. Deriving it from
// APP_URL instead is the mistake that produces a correctly configured OAuth
// client and a sign-in button that lands on a page that does not exist.
func TestSSORedirectURLDerivesFromAPIPublicURL(t *testing.T) {
	t.Setenv("API_PUBLIC_URL", "https://api.example.com/")

	tests := map[string]string{
		"google": "https://api.example.com/v1/auth/google/callback",
		"apple":  "https://api.example.com/v1/auth/apple/callback",
		"oidc":   "https://api.example.com/v1/auth/oidc/callback",
	}
	for provider, want := range tests {
		if got := ssoRedirectURL("", provider); got != want {
			t.Errorf("ssoRedirectURL(\"\", %q) = %q, want %q", provider, got, want)
		}
	}
}

func TestSSORedirectURLPrefersTheExplicitOverride(t *testing.T) {
	t.Setenv("API_PUBLIC_URL", "https://api.example.com")

	if got := ssoRedirectURL("  https://proxy.example.com/callback  ", "google"); got != "https://proxy.example.com/callback" {
		t.Errorf("got %q, want the trimmed override", got)
	}
}

// Without API_PUBLIC_URL there is nothing to derive from, and a relative path
// would be rejected by the provider. Empty is what disables the provider.
func TestSSORedirectURLEmptyWithoutAPublicBase(t *testing.T) {
	t.Setenv("API_PUBLIC_URL", "")
	t.Setenv("OIDC_REDIRECT_URL", "")

	if got := ssoRedirectURL("", "google"); got != "" {
		t.Errorf("got %q, want empty", got)
	}
	if got := oidcRedirectURL(); got != "" {
		t.Errorf("oidcRedirectURL() = %q, want empty", got)
	}
}

func TestOIDCRedirectURLStillReadsItsOwnOverride(t *testing.T) {
	t.Setenv("API_PUBLIC_URL", "https://api.example.com")
	t.Setenv("OIDC_REDIRECT_URL", "https://sso.example.com/finish")

	if got := oidcRedirectURL(); got != "https://sso.example.com/finish" {
		t.Errorf("got %q, want the OIDC_REDIRECT_URL override", got)
	}
}
