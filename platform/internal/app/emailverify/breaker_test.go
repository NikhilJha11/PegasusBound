package emailverify

import (
	"testing"
	"time"
)

func TestBreakerTripsOnAnInvalidFlood(t *testing.T) {
	b := newBreaker(20, 40, time.Hour)
	for i := 0; i < 9; i++ {
		if b.observe(false) {
			t.Fatal("closed breaker tripped on valid verdicts")
		}
	}
	// 9 of 19 invalid = 47%, above the threshold once half the window is filled.
	tripped := false
	for i := 0; i < 10; i++ {
		if b.observe(true) {
			tripped = true
		}
	}
	if !tripped || !b.open() {
		t.Fatal("breaker did not trip")
	}
	if !b.observe(false) {
		t.Fatal("open breaker must stay open during cooldown")
	}
}

func TestBreakerNeedsHalfAWindow(t *testing.T) {
	b := newBreaker(20, 40, time.Hour)
	for i := 0; i < 5; i++ {
		if b.observe(true) {
			t.Fatal("five verdicts are not evidence")
		}
	}
}
