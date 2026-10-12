package cipher

import (
	"context"

	"github.com/google/uuid"
	"github.com/pegasusbound/pegasusbound/internal/infrastructure/cache"
	"github.com/pegasusbound/pegasusbound/internal/infrastructure/encryptedkeys"
	"github.com/pegasusbound/pegasusbound/internal/infrastructure/kms"
)

type CipherService interface {
	Cipher(ctx context.Context, orgID uuid.UUID) (*Cipher, error)
}

type cipherService struct {
	encryptedKeys encryptedkeys.Store
	cache         *cache.Cache
	kms           kms.Provider
}

func NewService(kms kms.Provider, cache *cache.Cache, encryptedKeys encryptedkeys.Store) CipherService {
	return &cipherService{
		kms:           kms,
		cache:         cache,
		encryptedKeys: encryptedKeys,
	}
}
