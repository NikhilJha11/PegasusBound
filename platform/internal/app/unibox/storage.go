package unibox

import (
	"context"

	"github.com/google/uuid"
	"github.com/pegasusbound/pegasusbound/internal/config"
	"github.com/pegasusbound/pegasusbound/internal/pkg/emsg"
)

// GetBody reads a message's full body blob. The key must match what the
// worker's StoreBody writes; any other key finds nothing and the message
// degrades to its one-line snippet.
func (s *uniboxService) GetBody(
	ctx context.Context,
	userID, emailID, id uuid.UUID,
) (*emsg.EmailBlob, error) {
	key := config.StorageEndpointEmailBody(userID, emailID, id)
	body, err := s.blob.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	defer body.Close()

	obj, err := emsg.DecodeBinary(body)
	if err != nil {
		return nil, err
	}

	return obj, nil
}
