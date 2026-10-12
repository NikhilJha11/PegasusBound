package worker

import (
	"context"
	"time"

	"github.com/pegasusbound/pegasusbound/internal/infrastructure/eventbus"
	"github.com/pegasusbound/pegasusbound/internal/models"
)

type deliveryKey struct{}

// delivery is what a handler may know about the bus message it is processing.
type delivery struct {
	attempt    int  // 1-based delivery count; 0 when unknown
	redelivers bool // a handler error gets the message delivered again
}

// deliveryOf returns the bus delivery details for the message a handler is
// processing (zero value when the handler was not invoked from Receive).
func deliveryOf(ctx context.Context) delivery {
	d, _ := ctx.Value(deliveryKey{}).(delivery)
	return d
}

// Receive is the eventbus.Handler that drives the worker's event loop. It
// decodes the wire payload via the injected codec.Codec and dispatches to
// HandleEvent.
func (w *WorkerService) Receive(ctx context.Context, msg eventbus.Message) error {
	var event models.WorkerEvent
	if err := w.Codec.Deserialize(ctx, msg.Topic, msg.Payload, &event); err != nil {
		return err
	}

	hctx, cancel := context.WithTimeout(context.WithValue(ctx, deliveryKey{}, delivery{attempt: msg.Attempt, redelivers: msg.Redelivers}), 30*time.Second)
	defer cancel()
	return w.HandleEvent(hctx, &event)
}
