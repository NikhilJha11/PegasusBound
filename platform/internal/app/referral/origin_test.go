package referral

import (
	"context"
	"testing"

	"github.com/pegasusbound/pegasusbound/internal/config"
)

func TestReferralShareLinkUsesTrustedDashboard(t *testing.T) {
	t.Setenv("APP_URL", "https://app.pegasusbound.com")
	t.Setenv("APP_ORIGIN", "")
	t.Setenv("CORS_ALLOW_ORIGINS", "https://tac-security-assessment.pegasusbound.com")
	s := &service{shareBase: "https://app.pegasusbound.com"}
	for _, tt := range []struct{ origin, want string }{
		{"https://tac-security-assessment.pegasusbound.com", "https://tac-security-assessment.pegasusbound.com"},
		{"", "https://app.pegasusbound.com"},
		{"https://evil.example.com", "https://app.pegasusbound.com"},
	} {
		ctx := config.WithDashboardOrigin(context.Background(), tt.origin)
		if got := s.shareURL(ctx, "CODE1234"); got != tt.want+"/auth/register?ref=CODE1234" {
			t.Fatalf("share link = %q", got)
		}
	}
}
