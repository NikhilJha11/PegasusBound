package emailverify

import (
	"sync"
	"time"
)

// breaker is the in-house probe's self-check. Two incidents (#200, #264) had
// the probe reject good addresses wholesale because of its own environment
// (a rejected HELO, a blocklisted IP). A real list is never mostly dead, so
// when the share of "invalid" over the last window crosses the threshold the
// probe's rejections are filed as unknown, which still sends, until it has
// cooled down.
type breaker struct {
	mu        sync.Mutex
	window    int
	threshold float64
	cooldown  time.Duration
	ring      []bool
	pos       int
	filled    int
	invalid   int
	trippedAt time.Time
}

func newBreaker(window int, thresholdPct float64, cooldown time.Duration) *breaker {
	if window < 10 {
		window = 10
	}
	return &breaker{window: window, threshold: thresholdPct, cooldown: cooldown, ring: make([]bool, window)}
}

// observe records one probe verdict and reports whether the breaker is open.
func (b *breaker) observe(invalid bool) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !b.trippedAt.IsZero() {
		if time.Since(b.trippedAt) < b.cooldown {
			return true
		}
		// Cooled down: start measuring afresh.
		b.trippedAt = time.Time{}
		b.ring = make([]bool, b.window)
		b.pos, b.filled, b.invalid = 0, 0, 0
	}
	if b.filled == b.window {
		if b.ring[b.pos] {
			b.invalid--
		}
	} else {
		b.filled++
	}
	b.ring[b.pos] = invalid
	if invalid {
		b.invalid++
	}
	b.pos = (b.pos + 1) % b.window
	if b.filled < b.window/2 {
		return false
	}
	if float64(b.invalid)/float64(b.filled)*100 >= b.threshold {
		b.trippedAt = time.Now()
		return true
	}
	return false
}

// open reports whether the breaker is currently tripped.
func (b *breaker) open() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return !b.trippedAt.IsZero() && time.Since(b.trippedAt) < b.cooldown
}
