package worker

import (
	"context"
	"log"
	"time"
)

func (s *WorkerService) Heartbeat(ctx context.Context) {
	// Beat at once: the control plane refuses to hand sends to a worker with
	// no heartbeat key, so waiting a full interval would make a fresh worker
	// unusable for its first 90 seconds.
	if err := s.heartbeat(ctx); err != nil {
		log.Println("Failed to do heartbeat", err)
	}

	ticker := time.NewTicker(90 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("Stopping heartbeat for", s.ID)
			return
		case <-ticker.C:
			if err := s.heartbeat(ctx); err != nil {
				log.Println("Failed to do heartbeat", err)
			}
		}
	}
}
