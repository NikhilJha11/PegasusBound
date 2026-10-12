package socket

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/pegasusbound/pegasusbound/internal/app/token"
	"github.com/pegasusbound/pegasusbound/internal/errx"
	"github.com/pegasusbound/pegasusbound/internal/observability/errs"
	"github.com/pegasusbound/pegasusbound/internal/pkg/crypt"
)

func (s *socketService) GenerateWebsocketToken(ctx context.Context, userID uuid.UUID) (string, *errx.Error) {
	issuedAt := time.Now()
	expiresAt := issuedAt.Add(SocketTTL)
	id := uuid.New()
	nonce, err := crypt.Nonce()
	if err != nil {
		errs.CaptureException(err)
		return "", errx.InternalError()
	}

	wsToken, err := s.tokenService.GenerateTokenFor(token.PurposeWebSocket, userID, id, "", nonce, issuedAt, expiresAt)
	if err != nil {
		errs.CaptureException(err)
		return "", errx.InternalError()
	}

	if err := s.saveToken(ctx, id, nonce, expiresAt); err != nil {
		return "", err
	}

	return wsToken, nil
}
