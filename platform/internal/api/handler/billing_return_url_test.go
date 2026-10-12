package handler

import (
	"context"
	"testing"

	"github.com/pegasusbound/pegasusbound/internal/config"
)

func TestBillingReturnURLUsesInitiatingDashboard(t *testing.T) {
	t.Setenv("APP_URL", "https://app.pegasusbound.com")
	t.Setenv("APP_ORIGIN", "")
	t.Setenv("CORS_ALLOW_ORIGINS", "https://tac-security-assessment.pegasusbound.com")
	const assessment = "https://tac-security-assessment.pegasusbound.com"
	const fallback = "/app/settings/billing"
	for _, tt := range []struct{ origin, raw, want string }{
		{assessment, assessment + "/app/settings/billing/ai-credits?topup=success", assessment + "/app/settings/billing/ai-credits?topup=success"},
		{assessment, "/app/settings/billing?checkout=done", assessment + "/app/settings/billing?checkout=done"},
		{assessment, "", assessment + fallback},
		{assessment, "https://app.pegasusbound.com" + fallback, assessment + fallback},
		{"", "https://app.pegasusbound.com" + fallback, "https://app.pegasusbound.com" + fallback},
		{"", assessment + fallback, "https://app.pegasusbound.com" + fallback},
		{"https://evil.example.com", "/app/settings/billing", "https://app.pegasusbound.com" + fallback},
	} {
		ctx := config.WithDashboardOrigin(context.Background(), tt.origin)
		if got := billingReturnURL(ctx, tt.raw, fallback); got != tt.want {
			t.Errorf("origin %q URL %q = %q, want %q", tt.origin, tt.raw, got, tt.want)
		}
	}
	ctx := config.WithDashboardOrigin(context.Background(), assessment)
	for _, raw := range []string{
		"https://evil.example.com/", "//evil.example.com", "/\\evil.example.com", "https://tac-security-assessment.pegasusbound.com.evil.example.com/",
		"https://evil@tac-security-assessment.pegasusbound.com/", "http://tac-security-assessment.pegasusbound.com/", "https://tac-security-assessment.pegasusbound.com:444/", "javascript:alert(1)", "/path\nother", "/%zz",
	} {
		if got := billingReturnURL(ctx, raw, fallback); got != assessment+fallback {
			t.Errorf("unsafe URL %q returned %q", raw, got)
		}
	}
}
