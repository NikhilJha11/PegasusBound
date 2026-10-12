package instancecheck

import (
	"context"
	"strings"
	"testing"
)

func clearSignInEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI",
		"APPLE_APP_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_KEY_SECRET", "APPLE_REDIRECT_URI",
		"API_PUBLIC_URL", "APP_URL",
	} {
		t.Setenv(key, "")
	}
}

func TestGoogleSignInSilentWhenNothingIsConfigured(t *testing.T) {
	clearSignInEnv(t)

	if f := checkGoogleSignInIncomplete(context.Background(), Deps{}, Input{}); f != nil {
		t.Fatalf("reported %q on a deployment that never asked for Google sign-in", f.Title)
	}
}

// The report behind this check: a client id was set, nothing worked, and
// nothing said why.
func TestGoogleSignInReportsAMissingSecret(t *testing.T) {
	clearSignInEnv(t)
	t.Setenv("GOOGLE_CLIENT_ID", "client-id")
	t.Setenv("API_PUBLIC_URL", "https://api.example.com")

	f := checkGoogleSignInIncomplete(context.Background(), Deps{}, Input{})
	if f == nil {
		t.Fatal("a client id with no secret was reported as healthy")
	}
	if !strings.Contains(f.Message, "GOOGLE_CLIENT_SECRET") {
		t.Errorf("the finding does not name the missing variable: %s", f.Message)
	}
}

func TestGoogleSignInReportsAMissingRedirectBase(t *testing.T) {
	clearSignInEnv(t)
	t.Setenv("GOOGLE_CLIENT_ID", "client-id")
	t.Setenv("GOOGLE_CLIENT_SECRET", "client-secret")

	f := checkGoogleSignInIncomplete(context.Background(), Deps{}, Input{})
	if f == nil {
		t.Fatal("a complete client with nowhere to call back was reported as healthy")
	}
	if !strings.Contains(f.Message, "API_PUBLIC_URL") {
		t.Errorf("the finding does not name what to set: %s", f.Message)
	}
}

func TestGoogleSignInWarnsOnADashboardRedirect(t *testing.T) {
	clearSignInEnv(t)
	t.Setenv("GOOGLE_CLIENT_ID", "client-id")
	t.Setenv("GOOGLE_CLIENT_SECRET", "client-secret")
	t.Setenv("APP_URL", "https://app.example.com")
	t.Setenv("API_PUBLIC_URL", "https://api.example.com")
	t.Setenv("GOOGLE_REDIRECT_URI", "https://app.example.com/auth/google/callback")

	f := checkGoogleSignInIncomplete(context.Background(), Deps{}, Input{})
	if f == nil {
		t.Fatal("a redirect URI pointing at the dashboard was reported as healthy")
	}
	if !strings.Contains(f.Message, "https://api.example.com/v1/auth/google/callback") {
		t.Errorf("the finding does not name the URI to register instead: %s", f.Message)
	}
}

func TestGoogleSignInSilentWhenFullyConfigured(t *testing.T) {
	clearSignInEnv(t)
	t.Setenv("GOOGLE_CLIENT_ID", "client-id")
	t.Setenv("GOOGLE_CLIENT_SECRET", "client-secret")
	t.Setenv("APP_URL", "https://app.example.com")
	t.Setenv("API_PUBLIC_URL", "https://api.example.com")

	if f := checkGoogleSignInIncomplete(context.Background(), Deps{}, Input{}); f != nil {
		t.Fatalf("reported %q on a correctly configured deployment: %s", f.Title, f.Message)
	}
}

func TestAppleSignInNeedsEveryHalfAndHTTPS(t *testing.T) {
	clearSignInEnv(t)
	t.Setenv("APPLE_APP_ID", "com.example.service")
	t.Setenv("API_PUBLIC_URL", "https://api.example.com")

	f := checkAppleSignInIncomplete(context.Background(), Deps{}, Input{})
	if f == nil || !strings.Contains(f.Message, "APPLE_TEAM_ID") {
		t.Fatalf("a Services ID on its own was not reported as incomplete: %+v", f)
	}

	t.Setenv("APPLE_TEAM_ID", "TEAM")
	t.Setenv("APPLE_KEY_ID", "KEY")
	t.Setenv("APPLE_KEY_SECRET", "secret")
	if f := checkAppleSignInIncomplete(context.Background(), Deps{}, Input{}); f != nil {
		t.Fatalf("reported %q on a correctly configured deployment: %s", f.Title, f.Message)
	}

	t.Setenv("API_PUBLIC_URL", "http://localhost:8080")
	f = checkAppleSignInIncomplete(context.Background(), Deps{}, Input{})
	if f == nil || !strings.Contains(f.Title, "HTTPS") {
		t.Fatalf("a plain-http return URL was accepted: %+v", f)
	}
}
