package campaign

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/pegasusbound/pegasusbound/internal/errx"
	"github.com/pegasusbound/pegasusbound/internal/models"
)

func TestUpdateRejectsMalformedRelationsBeforeRepository(t *testing.T) {
	for _, data := range []*models.UpdateCampaign{
		{EmailTags: []string{"cro-c6"}},
		{EmailTags: []string{uuid.NewString(), "cro-c6"}},
		{Folders: []string{"None"}},
		{Folders: []string{uuid.NewString(), ""}},
	} {
		_, err := (&campaignService{}).Update(context.Background(), "org", "campaign", data)
		if err == nil || err.Code != errx.BadRequest {
			t.Fatalf("error=%v; want bad_request", err)
		}
	}
}
