package middleware

import (
	"github.com/pegasusbound/pegasusbound/internal/app/apikey"
	"github.com/pegasusbound/pegasusbound/internal/app/idempotency"
	"github.com/pegasusbound/pegasusbound/internal/app/oauth"
	"github.com/pegasusbound/pegasusbound/internal/app/organization"
	"github.com/pegasusbound/pegasusbound/internal/app/poollink"
	"github.com/pegasusbound/pegasusbound/internal/app/ratelimit"
	"github.com/pegasusbound/pegasusbound/internal/app/token"
	"github.com/pegasusbound/pegasusbound/internal/infrastructure/cache"
)

type Handler struct {
	TokenService        token.TokenService
	APIKeyService       apikey.APIKeyService
	IdempotencyService  idempotency.Service
	RateLimitService    ratelimit.RateLimitService
	OrganizationService organization.OrganizationService
	// OAuthService validates OAuth 2.1 bearer access tokens (nil-safe: when
	// unset, only JWT + API-key auth are accepted).
	OAuthService *oauth.Service
	// Cache backs the pre-login per-IP limiter, which cannot use
	// RateLimitService because that one is keyed on a user id that does not
	// exist yet.
	Cache *cache.Cache
	// PoolLinkService authenticates linked instances; nil-safe, routes answer 501.
	PoolLinkService poollink.Service
}
