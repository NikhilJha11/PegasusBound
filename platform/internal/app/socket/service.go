package socket

import (
	"context"

	"github.com/google/uuid"
	"github.com/pegasusbound/pegasusbound/internal/app/token"
	"github.com/pegasusbound/pegasusbound/internal/errx"
	"github.com/pegasusbound/pegasusbound/internal/infrastructure/cache"
)

type SocketService interface {
	GenerateWebsocketToken(ctx context.Context, userID uuid.UUID) (string, *errx.Error)
}

type socketService struct {
	cache        *cache.Cache
	tokenService token.TokenService
}

func NewService(cache *cache.Cache, tokenService token.TokenService) SocketService {
	return &socketService{
		cache:        cache,
		tokenService: tokenService,
	}
}
