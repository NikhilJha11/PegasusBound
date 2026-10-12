//go:build kafka

package worker

import (
	"testing"

	"github.com/pegasusbound/pegasusbound/internal/infrastructure/codec"
)

func TestAvroCommandKeysGroupLegacySendKeysWithMailboxMutations(t *testing.T) {
	c, err := codec.NewAvro("mock://command-key", "", "")
	if err != nil {
		t.Fatal(err)
	}
	checkCommandKeys(t, &WorkerService{Codec: c})
}
